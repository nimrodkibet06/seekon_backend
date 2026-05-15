import cron from 'node-cron';
import mongoose from 'mongoose';
import { getResendClient } from '../utils/email.js';

const BACKUP_RECIPIENTS = [
  'Nimrodkibet376@gmail.com',
  'seekonapparel77@gmail.com',
];

const EMAIL_FROM = process.env.EMAIL_FROM || 'Seekon <noreply@seekonapparelglobal.com>';

let backupInProgress = false;
let scheduledTask = null;

const formatBackupDate = (date) =>
  date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const formatFileTimestamp = (date) =>
  date.toISOString().replace(/[:.]/g, '-');

/**
 * Build a safe summary for logging (counts only, no document bodies or secrets).
 */
const buildBackupSummary = (backup) => {
  const collections = Object.keys(backup.data);
  return {
    timestamp: backup.timestamp,
    databaseName: backup.databaseName,
    collectionCount: collections.length,
    documentCounts: collections.reduce((acc, name) => {
      acc[name] = Array.isArray(backup.data[name]) ? backup.data[name].length : 0;
      return acc;
    }, {}),
    totalDocuments: collections.reduce(
      (sum, name) => sum + (backup.data[name]?.length ?? 0),
      0
    ),
  };
};

/**
 * Export every collection dynamically (no hardcoded models).
 */
export const createFullDatabaseBackup = async () => {
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error('MongoDB connection is not ready');
  }

  const databaseName = db.databaseName;
  const timestamp = new Date().toISOString();
  const data = {};

  const collectionInfos = await db.listCollections().toArray();

  console.log(`[Backup] Crawling ${collectionInfos.length} collection(s) in "${databaseName}"...`);

  for (const { name: collectionName } of collectionInfos) {
    const documents = await db.collection(collectionName).find({}).toArray();
    data[collectionName] = documents;
    console.log(`[Backup]   ${collectionName}: ${documents.length} document(s)`);
  }

  return {
    timestamp,
    databaseName,
    data,
  };
};

/**
 * Send backup JSON as a Resend email attachment (off-site copy per 3-2-1).
 */
export const sendBackupEmail = async (backup) => {
  const resend = getResendClient();

  if (!resend) {
    throw new Error('Resend is not configured (RESEND_API_KEY missing or invalid)');
  }

  const backupDate = new Date(backup.timestamp);
  const subject = `Seekon Database Backup - ${formatBackupDate(backupDate)}`;
  const filename = `seekon_full_backup_${formatFileTimestamp(backupDate)}.json`;
  const jsonBuffer = Buffer.from(JSON.stringify(backup, null, 2), 'utf-8');
  const sizeMb = (jsonBuffer.length / (1024 * 1024)).toFixed(2);

  const summary = buildBackupSummary(backup);

  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: BACKUP_RECIPIENTS,
    subject,
    html: `
      <h2>Seekon Full Database Backup</h2>
      <p>Automated nightly backup of MongoDB Atlas.</p>
      <ul>
        <li><strong>Database:</strong> ${backup.databaseName}</li>
        <li><strong>Timestamp (UTC):</strong> ${backup.timestamp}</li>
        <li><strong>Collections:</strong> ${summary.collectionCount}</li>
        <li><strong>Total documents:</strong> ${summary.totalDocuments}</li>
        <li><strong>Attachment size:</strong> ${sizeMb} MB</li>
      </ul>
      <p>The full export is attached as <code>${filename}</code>.</p>
      <p style="color:#666;font-size:12px;">Store this file securely. It may contain hashed credentials required for restore.</p>
    `,
    attachments: [
      {
        filename,
        content: jsonBuffer,
        contentType: 'application/json',
      },
    ],
  });

  if (error) {
    throw new Error(error.message || 'Resend failed to send backup email');
  }

  return { data, filename, sizeMb };
};

/**
 * Run a single full backup cycle (export + email).
 */
export const runFullBackup = async () => {
  if (backupInProgress) {
    console.warn('[Backup] Skipped: a backup is already in progress');
    return;
  }

  backupInProgress = true;
  const startedAt = Date.now();

  console.log('[Backup] Starting full database backup...');

  try {
    const backup = await createFullDatabaseBackup();
    const summary = buildBackupSummary(backup);

    console.log('[Backup] Export complete:', JSON.stringify(summary, null, 2));

    const { filename, sizeMb } = await sendBackupEmail(backup);

    console.log(
      `[Backup] Success: emailed ${filename} (${sizeMb} MB) to ${BACKUP_RECIPIENTS.join(', ')}`
    );
    console.log(`[Backup] Finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('[Backup] Failed:', err.message);
    if (err.stack) {
      console.error('[Backup] Stack:', err.stack);
    }
    throw err;
  } finally {
    backupInProgress = false;
  }
};

/**
 * Schedule nightly backup at 00:00 server time.
 */
export const startBackupScheduler = () => {
  if (scheduledTask) {
    console.warn('[Backup] Scheduler already running');
    return scheduledTask;
  }

  if (!process.env.MONGO_URI) {
    console.warn('[Backup] MONGO_URI not set — backup scheduler not started');
    return null;
  }

  // Midnight daily (server local time)
  scheduledTask = cron.schedule('0 0 * * *', async () => {
    console.log('[Backup] Cron triggered at midnight');
    try {
      await runFullBackup();
    } catch {
      // Errors already logged in runFullBackup
    }
  });

  console.log('[Backup] Scheduler started — full backup daily at 00:00 (server time)');
  console.log(`[Backup] Recipients: ${BACKUP_RECIPIENTS.join(', ')}`);

  return scheduledTask;
};
