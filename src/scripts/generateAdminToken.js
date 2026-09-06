import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function run() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // Find any user with role = admin
    const User = mongoose.connection.model('User', new mongoose.Schema({
      role: String
    }, { strict: false }), 'users');

    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      console.error('❌ No admin user found in database!');
      process.exit(1);
    }
    console.log(`👤 Found admin user: ID ${admin._id}`);

    // Generate token
    const token = jwt.sign(
      { userId: admin._id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log(`🔑 Generated Admin JWT Token: ${token}`);

    console.log('🚀 Triggering automated self-status update...');
    const res = await axios.post(
      'http://localhost:3000/api/settings/trigger-self-status',
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    console.log('✅ Response:', res.data);
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.');
  } catch (err) {
    console.error('❌ Error running auto status trigger script:', err.message);
    if (err.response) {
      console.error('   Server response:', err.response.data);
    }
    try {
      await mongoose.disconnect();
    } catch (dbErr) {}
  }
}

run();
