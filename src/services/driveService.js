import { google } from 'googleapis';
import { Readable } from 'stream';

let driveClient = null;
let driveChecked = false;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

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
 * Lazy-init Google Drive client (service account JWT).
 */
export const getDriveClient = () => {
  if (driveClient) return driveClient;
  if (driveChecked) return null;

  driveChecked = true;

  if (!isDriveConfigured()) {
    console.warn('[Drive] Not configured — set GOOGLE_DRIVE_CREDENTIALS and GOOGLE_DRIVE_FOLDER_ID');
    return null;
  }

  try {
    const credentials = parseCredentials();
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      [DRIVE_SCOPE]
    );

    driveClient = google.drive({ version: 'v3', auth });
    console.log('[Drive] Client initialized');
    return driveClient;
  } catch (err) {
    console.error('[Drive] Failed to initialize:', err.message);
    return null;
  }
};

/**
 * Upload JSON backup to the configured Drive folder.
 */
export const uploadBackupToDrive = async (backup, filename) => {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!drive || !folderId) {
    throw new Error('Google Drive is not configured');
  }

  const json = JSON.stringify(backup, null, 2);
  const buffer = Buffer.from(json, 'utf-8');
  const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);

  const { data } = await drive.files.create({
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
  });

  console.log(`[Drive] Uploaded ${data.name} (${sizeMb} MB) — id: ${data.id}`);

  return { fileId: data.id, filename: data.name, sizeMb, webViewLink: data.webViewLink };
};

/**
 * Delete backup files in the folder older than retentionDays (default 30).
 */
export const pruneOldBackups = async (retentionDays = 30) => {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!drive || !folderId) {
    return { deleted: 0, skipped: true };
  }

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
    });

    for (const file of data.files || []) {
      const created = new Date(file.createdTime).getTime();
      if (created < cutoff) {
        await drive.files.delete({ fileId: file.id });
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
