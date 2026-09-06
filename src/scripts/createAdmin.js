import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const existingAdmin = await Admin.findOne({ email: 'admin@seekon.com' });
    
    if (existingAdmin) {
      console.log('ℹ️  Admin user already exists');
      process.exit(0);
    }

    const admin = await Admin.create({
      username: 'admin',
      email: 'admin@seekon.com',
      password: 'admin123', // Will be hashed automatically
      role: 'super_admin'
    });

    console.log('✅ Admin user created successfully!');
    console.log('📧 Email: admin@seekon.com');
    console.log('🔑 Password: admin123');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error);
    process.exit(1);
  }
};

createAdmin();




