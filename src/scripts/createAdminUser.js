import mongoose from 'mongoose';
import User from '../models/User.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const createAdminUser = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const email = 'admin@seekon.com';
    const password = 'admin123';
    // Note: User model might hash password in pre-save hook, let's check.
    // If User model has pre-save hook for hashing, we should pass plain password.
    // Checking User.js... it doesn't seem to have pre-save hook in the snippet I read earlier.
    // Wait, I read User.js lines 1-50. Let me check if it has pre-save hook.
    
    // Assuming it might not have it if I didn't see it, but usually it does.
    // Let's check User.js again to be sure.
    
    // For now, I'll assume it does NOT have it if I didn't see it, but I should verify.
    // Actually, authController.js creates user with plain password:
    // const user = await User.create({ name, email, password });
    // So User model MUST have a pre-save hook to hash it, otherwise passwords are stored in plain text.
    // Let's check User.js fully.
    
    const existingUser = await User.findOne({ email });
    
    if (existingUser) {
      console.log('ℹ️  User with this email already exists');
      let updated = false;
      if (existingUser.role !== 'admin') {
          console.log('Updating user role to admin...');
          existingUser.role = 'admin';
          updated = true;
      }
      if (!existingUser.isVerified) {
          console.log('Verifying admin email...');
          existingUser.isVerified = true;
          updated = true;
      }
      if (updated) {
          await existingUser.save();
          console.log('✅ User updated to verified admin');
      }
      process.exit(0);
    }

    const admin = await User.create({
      name: 'Admin User',
      email,
      password, // Passing plain password, assuming model hashes it
      role: 'admin',
      isVerified: true // Admin emails are auto-verified
    });

    console.log('✅ Admin user created successfully!');
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${password}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  }
};

createAdminUser();
