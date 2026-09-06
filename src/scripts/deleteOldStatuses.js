import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

import mongoose from 'mongoose';
import FlashStatus from '../models/FlashStatus.js';

// 13:20 Local Time (GMT+3) corresponds to 10:20 UTC
const cutOffDate = new Date('2026-07-10T10:20:00.000Z');

async function deleteOldStatuses() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');
  console.log(`🔍 Finding status updates created before: ${cutOffDate.toISOString()} (13:20 local time)`);

  const statusesToDelete = await FlashStatus.find({ createdAt: { $lt: cutOffDate } });
  console.log(`📋 Found ${statusesToDelete.length} status(es) to delete.`);

  if (statusesToDelete.length > 0) {
    const result = await FlashStatus.deleteMany({ createdAt: { $lt: cutOffDate } });
    console.log(`🗑️ Successfully deleted ${result.deletedCount} status record(s) from MongoDB.`);
  } else {
    console.log('ℹ️ No statuses matched the criteria.');
  }

  await mongoose.disconnect();
  console.log('🔌 Disconnected.');
}

deleteOldStatuses().catch(e => {
  console.error('❌ Error deleting old statuses:', e.message);
  process.exit(1);
});
