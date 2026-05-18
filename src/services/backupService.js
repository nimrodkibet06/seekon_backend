import mongoose from 'mongoose';
import {
  isDriveConfigured,
  uploadBackupToDrive,
  pruneOldBackups,
} from './driveService.js';

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes idle after last successful transaction
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 30;

let backupTimeout = null;
let backupInProgress = false;

const formatFileTimestamp = (date) =>
  date.toISOString().replace(/[:.]/g, '-');

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
 * Dynamically export all MongoDB collections (no hardcoded models).
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

  return { timestamp, databaseName, data };
};

/**
 * Full backup cycle: MongoDB dump → Google Drive upload → retention prune.
 */
export const runFullBackup = async () => {
  if (backupInProgress) {
    console.warn('[Backup] Skipped: a backup is already in progress');
    return;
  }

  if (!isDriveConfigured()) {
    console.warn('[Backup] Skipped: Google Drive is not configured');
    return;
  }

  backupInProgress = true;
  const startedAt = Date.now();

  console.log('[Backup] Starting full database backup → Google Drive...');

  try {
    const backup = await createFullDatabaseBackup();
    const summary = buildBackupSummary(backup);
    console.log('[Backup] Export complete:', JSON.stringify(summary, null, 2));

    const filename = `seekon_backup_${formatFileTimestamp(new Date(backup.timestamp))}.json`;
    const upload = await uploadBackupToDrive(backup, filename);

    const { deleted } = await pruneOldBackups(RETENTION_DAYS);

    console.log(
      `[Backup] Success: ${upload.filename} uploaded (${upload.sizeMb} MB). Retention removed ${deleted} old file(s).`
    );
    console.log(`[Backup] Finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

    return { ...upload, summary };
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
 * Fire-and-forget backup run (never blocks the HTTP response path).
 */
const executeBackupAsync = () => {
  setImmediate(() => {
    runFullBackup().catch(() => {
      // Errors logged inside runFullBackup
    });
  });
};

/**
 * Debounced trigger: reset 5-minute idle timer on each successful Paystack transaction.
 * Non-blocking — only schedules a timeout.
 */
export const scheduleDebouncedBackup = () => {
  if (!isDriveConfigured()) {
    return;
  }

  if (backupTimeout) {
    clearTimeout(backupTimeout);
  }

  backupTimeout = setTimeout(() => {
    backupTimeout = null;
    console.log('[Backup] Debounce idle period elapsed — starting backup');
    executeBackupAsync();
  }, DEBOUNCE_MS);

  console.log('[Backup] Debounced backup scheduled (5 min after last successful transaction)');
};

/**
 * Run backup immediately (no debounce). Used for manual/ops triggers.
 */
export const runImmediateBackup = () => {
  console.log('[Backup] Immediate backup requested');
  executeBackupAsync();
};

export const initBackupService = () => {
  if (isDriveConfigured()) {
    console.log('[Backup] Google Drive backup enabled (event-driven, 5 min debounce)');
    console.log(`[Backup] Retention: ${RETENTION_DAYS} days`);
    // One immediate backup on startup so deploy/Railway logs confirm Drive is working
    runImmediateBackup();
  } else {
    console.warn('[Backup] Google Drive backup disabled — missing GOOGLE_DRIVE_* env vars');
  }
};
