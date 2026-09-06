import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

import mongoose from 'mongoose';
import Setting from '../models/Setting.js';

const LID_TO_APPROVE = '279216193032354@lid';

async function approveLid() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const result = await Setting.findOneAndUpdate(
    { key: 'authorized_status_lids' },
    { $addToSet: { 'value.lids': LID_TO_APPROVE }, $set: { updatedAt: Date.now() } },
    { upsert: true, new: true }
  );
  console.log('✅ Approved LIDs in DB:', result.value.lids);

  // Also remove from pending
  await Setting.findOneAndUpdate(
    { key: 'pending_status_lids' },
    { $pull: { 'value.lids': LID_TO_APPROVE } }
  );
  console.log('🗑️  Removed from pending list');

  await mongoose.disconnect();
  console.log('🔌 Done.');
}

approveLid().catch(e => { console.error(e.message); process.exit(1); });
