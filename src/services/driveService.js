import { google } from 'googleapis';
import { Readable } from 'stream';

const CALLBACK_URI = 'https://developers.google.com/oauthplayground';

let driveClient = null;
let oauth2Client = null;
let driveInitPromise = null;

/**
 * Clean folder ID from env (quotes, whitespace, or full Drive URL pasted by mistake).
 */
export const getBackupFolderId = () => {
  let id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || '';
  id = id.replace(/^['\"]|['\"]$/g, '');

  const urlMatch = id.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    id = urlMatch[1];
  }

  return id;
};

export const isDriveConfigured = () =>
  Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() &&
      getBackupFolderId()
  );

const ensureDriveClient = async () => {
  if (driveClient) {
    return driveClient;
  }

  if (driveInitPromise) {
    return driveInitPromise;
  }

  driveInitPromise = (async () => {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        'Google Drive OAuth2 is not configured. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN.'
      );
    }

    oauth2Client = new google.auth.OAuth2(clientId, clientSecret, CALLBACK_URI);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    driveClient = google.drive({ version: 'v3', auth: oauth2Client });
    console.log('[Drive] OAuth2 Drive client initialized');
    return driveClient;
  })();

  try {
    return await driveInitPromise;
  } catch (err) {
    driveInitPromise = null;
    driveClient = null;
    oauth2Client = null;
    console.error('[Drive] Failed to initialize OAuth2 client:', err.message);
    throw err;
  }
};

const assertBackupFolderAccessible = async (drive, folderId) => {
  try {
    const { data } = await drive.files.get({
      fileId: folderId,
      supportsAllDrives: true,
      supportsTeamDrives: true,
      fields: 'id, name, mimeType, driveId, webViewLink',
    });

    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error(`GOOGLE_DRIVE_FOLDER_ID (${folderId}) is not a folder`);
    }

    console.log(
      `[Drive] Target folder verified: "${data.name}" (${data.id}), driveId=${data.driveId || 'none'}`
    );
    return data;
  } catch (err) {
    throw new Error(
      `Cannot access backup folder "${folderId}". Ensure the authenticated user has Editor access to the folder. Original error: ${err.message}`
    );
  }
};

export const getDriveClient = () => driveClient;

export const uploadBackupToDrive = async (backup, filename) => {
  const folderId = getBackupFolderId();

  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set');
  }

  const drive = await ensureDriveClient();
  await assertBackupFolderAccessible(drive, folderId);

  const jsonString = JSON.stringify(backup, null, 2);

  console.log(`[Drive] Initiating OAuth2 upload to folder ID: ${folderId}`);

  const response = await drive.files.create({
    requestBody: {
      name: filename || `seekon_backup_${Date.now()}.json`,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/json',
      body: Readable.from(jsonString),
    },
    supportsAllDrives: true,
  });

  console.log(`[Drive] File created successfully via OAuth2! ID: ${response.data.id}`);

  return {
    fileId: response.data.id,
    filename: response.data.name || filename,
    sizeMb: (Buffer.byteLength(jsonString, 'utf-8') / (1024 * 1024)).toFixed(2),
    webViewLink: response.data.webViewLink,
  };
};

export const pruneOldBackups = async (retentionDays = 30) => {
  const folderId = getBackupFolderId();

  if (!folderId) {
    return { deleted: 0, skipped: true };
  }

  const drive = await ensureDriveClient();
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  let pageToken;
  let deleted = 0;

  do {
    const { data } = await drive.files.list({
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
        try {
          await drive.files.delete({
            fileId: file.id,
            supportsAllDrives: true,
          });
          deleted += 1;
          console.log(`[Drive] Deleted expired backup: ${file.name}`);
        } catch (deleteError) {
          if (deleteError.message?.toLowerCase().includes('permission') || deleteError.status === 403) {
            console.warn(`⚠️ [Drive] Skipped deleting old backup file ${file.id} (${file.name}) due to insufficient permissions.`);
          } else {
            console.error(`⚠️ [Drive] Error deleting old backup file ${file.id} (${file.name}):`, deleteError.message);
          }
          // Continue to next file instead of throwing
        }
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  if (deleted > 0) {
    console.log(`[Drive] Retention: removed ${deleted} file(s) older than ${retentionDays} days`);
  }

  return { deleted, skipped: false };
};
