import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

import mongoose from 'mongoose';
import FlashStatus from '../models/FlashStatus.js';
import cloudinary from '../config/cloudinary.js';

// 13:20 Local Time (GMT+3) corresponds to 10:20 UTC
const cutOffDate = new Date('2026-07-10T10:20:00.000Z');

async function deleteOldStatuses() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');
  console.log(`🔍 Finding status updates created before: ${cutOffDate.toISOString()} (13:20 local time)`);

  const statusesToDelete = await FlashStatus.find({ createdAt: { $lt: cutOffDate } });
  console.log(`📋 Found ${statusesToDelete.length} status(es) to delete.`);

  if (statusesToDelete.length === 0) {
    console.log('ℹ️ No statuses matched the criteria.');
    await mongoose.disconnect();
    console.log('🔌 Disconnected.');
    return;
  }

  let deletedCount = 0;
  for (const status of statusesToDelete) {
    try {
      // Destroy the Cloudinary asset before removing the DB record
      const resourceType = status.mediaType === 'video' ? 'video' : 'image';
      const destroyResult = await new Promise((resolve, reject) => {
        cloudinary.uploader.destroy(
          status.cloudinaryPublicId,
          { resource_type: resourceType },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
      });

      if (destroyResult && (destroyResult.result === 'ok' || destroyResult.result === 'not_found')) {
        await FlashStatus.findByIdAndDelete(status._id);
        deletedCount++;
        console.log(`🗑️ Deleted status ${status._id} + Cloudinary asset ${status.cloudinaryPublicId}`);
      } else {
        console.error(`❌ Cloudinary returned unexpected response for ${status.cloudinaryPublicId}:`, destroyResult);
      }
    } catch (err) {
      console.error(`❌ Failed to clean up status ${status._id}:`, err.message);
    }
  }

  console.log(`✅ Successfully deleted ${deletedCount}/${statusesToDelete.length} status record(s).`);
  await mongoose.disconnect();
  console.log('🔌 Disconnected.');
}

deleteOldStatuses().catch(e => {
  console.error('❌ Error deleting old statuses:', e.message);
  process.exit(1);
});
