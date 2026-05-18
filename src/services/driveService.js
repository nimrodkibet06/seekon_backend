import { google } from 'googleapis';
import { Readable } from 'stream';

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

export const isDriveConfigured = () =>
  Boolean(
    process.env.GOOGLE_DRIVE_CREDENTIALS?.trim() &&
      process.env.GOOGLE_DRIVE_FOLDER_ID?.trim()
  );

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

    authClient = new google.auth.JWT({
      email: credentials.client_email,
      key: privateKey,
      scopes: [DRIVE_SCOPE],
    });

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

/** @deprecated Use ensureDriveClients — kept for sync config checks in backupService */
export const getDriveClient = () => driveClient;

/**
 * Upload JSON backup to the configured Drive folder.
 */
export const uploadBackupToDrive = async (backup, filename) => {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();

  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set');
  }

  const { drive, auth } = await ensureDriveClients();

  const json = JSON.stringify(backup, null, 2);
  const buffer = Buffer.from(json, 'utf-8');
  const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);

  const { data } = await drive.files.create({
    auth,
    requestBody: {
      name: filename,
      parents: [folderId],
      mimeType: 'application/json',
    },
    media: {
      mimeType: 'application/json',
      body: Readable.from(buffer),
    },
    fields: 'id, name, createdTime, webViewLink',
    supportsAllDrives: true,
  });

  console.log(`[Drive] Uploaded ${data.name} (${sizeMb} MB) — id: ${data.id}`);

  return { fileId: data.id, filename: data.name, sizeMb, webViewLink: data.webViewLink };
};

/**
 * Delete backup files in the folder older than retentionDays (default 30).
 */
export const pruneOldBackups = async (retentionDays = 30) => {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();

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
