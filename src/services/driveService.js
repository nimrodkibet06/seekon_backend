import { google } from 'googleapis';

let driveClient = null;
let authClient = null;
let driveInitPromise = null;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

/** Railway/env often stores PEM newlines as literal \\n — normalize before JWT sign. */
const normalizePrivateKey = (key) => {
  if (!key || typeof key !== 'string') return key;
  return key.replace(/\\n/g, '\n').trim();
};

const parseCredentials = () => {
  const raw = process.env.GOOGLE_DRIVE_CREDENTIALS;
  if (!raw?.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    } catch {
      throw new Error('GOOGLE_DRIVE_CREDENTIALS must be valid JSON (or base64-encoded JSON)');
    }
  }
};

/**
 * Clean folder ID from env (quotes, whitespace, or full Drive URL pasted by mistake).
 */
export const getBackupFolderId = () => {
  let id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || '';
  id = id.replace(/^["']|["']$/g, '');

  const urlMatch = id.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    id = urlMatch[1];
  }

  return id;
};

export const isDriveConfigured = () =>
  Boolean(process.env.GOOGLE_DRIVE_CREDENTIALS?.trim() && getBackupFolderId());

/**
 * Initialize JWT auth + Drive client (authorized once, reused).
 */
const ensureDriveClients = async () => {
  if (driveClient && authClient) {
    return { drive: driveClient, auth: authClient };
  }

  if (driveInitPromise) {
    return driveInitPromise;
  }

  driveInitPromise = (async () => {
    if (!isDriveConfigured()) {
      throw new Error('Google Drive is not configured');
    }

    const credentials = parseCredentials();
    const privateKey = normalizePrivateKey(credentials.private_key);

    if (!credentials.client_email || !privateKey) {
      throw new Error('Service account JSON must include client_email and private_key');
    }

    const impersonateEmail = process.env.GOOGLE_DRIVE_IMPERSONATE_EMAIL?.trim();

    authClient = new google.auth.JWT({
      email: credentials.client_email,
      key: privateKey,
      scopes: [DRIVE_SCOPE],
      // Optional: Google Workspace domain-wide delegation (uploads as this user)
      ...(impersonateEmail ? { subject: impersonateEmail } : {}),
    });

    if (impersonateEmail) {
      console.log(`[Drive] Using domain-wide delegation as ${impersonateEmail}`);
    }

    await authClient.authorize();

    driveClient = google.drive({ version: 'v3', auth: authClient });
    console.log('[Drive] Client initialized and authorized');

    return { drive: driveClient, auth: authClient };
  })();

  try {
    return await driveInitPromise;
  } catch (err) {
    driveInitPromise = null;
    authClient = null;
    driveClient = null;
    console.error('[Drive] Failed to initialize:', err.message);
    throw err;
  }
};

/**
 * Confirm the backup folder exists and is visible to the service account.
 * Files must be created WITH parents set to this folder so they use the owner's quota.
 */
const assertBackupFolderAccessible = async (drive, auth, folderId) => {
  try {
    const { data } = await drive.files.get({
      auth,
      fileId: folderId,
      supportsAllDrives: true,
      fields: 'id, name, mimeType, driveId',
    });

    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error(`GOOGLE_DRIVE_FOLDER_ID (${folderId}) is not a folder`);
    }

    console.log(`[Drive] Target folder verified: "${data.name}" (${data.id})`);
    return data;
  } catch (err) {
    const credentials = parseCredentials();
    const saEmail = credentials?.client_email || 'your-service-account@project.iam.gserviceaccount.com';
    throw new Error(
      `Cannot access backup folder "${folderId}". Share the folder in Google Drive with ` +
        `${saEmail} as Editor, then redeploy. Original error: ${err.message}`
    );
  }
};

/** @deprecated Use ensureDriveClients */
export const getDriveClient = () => driveClient;

/**
 * Resumable upload: metadata (with parents) is sent first, then bytes.
 * Avoids googleapis multipart stripping parents AND files.update() SA quota errors.
 * @see https://developers.google.com/workspace/drive/api/guides/manage-uploads#resumable
 */
const uploadViaResumableSession = async (auth, folderId, filename, jsonString) => {
  const { token } = await auth.getAccessToken();
  if (!token) {
    throw new Error('Failed to obtain Google access token');
  }

  const metadata = {
    name: filename,
    mimeType: 'application/json',
    parents: [folderId],
  };

  const initResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new Error(`Resumable session failed (${initResponse.status}): ${errText}`);
  }

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) {
    throw new Error('Resumable upload missing Location header from Google');
  }

  const contentBuffer = Buffer.from(jsonString, 'utf-8');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(contentBuffer.length),
    },
    body: contentBuffer,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`Resumable upload failed (${uploadResponse.status}): ${errText}`);
  }

  return uploadResponse.json();
};

/**
 * Upload JSON backup into the shared folder (uses folder owner's quota, not SA storage).
 */
export const uploadBackupToDrive = async (backup, filename) => {
  const folderId = getBackupFolderId();

  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set');
  }

  const { drive, auth } = await ensureDriveClients();
  await assertBackupFolderAccessible(drive, auth, folderId);

  const jsonString = JSON.stringify(backup, null, 2);
  const sizeMb = (Buffer.byteLength(jsonString, 'utf-8') / (1024 * 1024)).toFixed(2);

  console.log(`[Drive] Starting resumable upload to folder ${folderId}...`);

  const data = await uploadViaResumableSession(auth, folderId, filename, jsonString);

  if (!data.parents?.includes(folderId)) {
    console.warn(
      `[Drive] Upload OK but parents=${JSON.stringify(data.parents)} — expected ${folderId}`
    );
  }

  console.log(`[Drive] Uploaded ${data.name} (${sizeMb} MB) into folder ${folderId} — id: ${data.id}`);

  return {
    fileId: data.id,
    filename: data.name || filename,
    sizeMb,
    webViewLink: data.webViewLink,
  };
};

/**
 * Delete backup files in the folder older than retentionDays (default 30).
 */
export const pruneOldBackups = async (retentionDays = 30) => {
  const folderId = getBackupFolderId();

  if (!folderId) {
    return { deleted: 0, skipped: true };
  }

  const { drive, auth } = await ensureDriveClients();

  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  let pageToken;
  let deleted = 0;

  do {
    const { data } = await drive.files.list({
      auth,
      q: `'${folderId}' in parents and trashed=false and name contains 'seekon_backup_'`,
      fields: 'nextPageToken, files(id, name, createdTime)',
      orderBy: 'createdTime',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const file of data.files || []) {
      const created = new Date(file.createdTime).getTime();
      if (created < cutoff) {
        await drive.files.delete({
          auth,
          fileId: file.id,
          supportsAllDrives: true,
        });
        deleted += 1;
        console.log(`[Drive] Deleted expired backup: ${file.name}`);
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  if (deleted > 0) {
    console.log(`[Drive] Retention: removed ${deleted} file(s) older than ${retentionDays} days`);
  }

  return { deleted, skipped: false };
};
