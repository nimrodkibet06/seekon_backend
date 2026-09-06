import dotenv from 'dotenv';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import FlashStatus from '../models/FlashStatus.js';

// Load environment variables
dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
  if (!mongoUri) {
    throw new Error('Neither MONGO_URI nor DATABASE_URL environment variable is defined!');
  }
  await mongoose.connect(mongoUri, { family: 4 });
  console.log('✅ MongoDB Connected for verification.');
};

const runVerification = async () => {
  let testStatusId = null;
  let testPublicId = null;

  try {
    console.log('🚀 Starting Zero-Click WhatsApp Status CMS Engine Verification Script...');
    
    // Connect DB
    await connectDB();

    // 1. Buffer Ingestion (Create mock image buffer)
    console.log('\n--- STEP 1: Buffer Ingestion ---');
    const mockImageBase64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // 1x1 pixel gif
    const originalBuffer = Buffer.from(mockImageBase64, 'base64');
    console.log(`✅ Ingested mock image buffer (${originalBuffer.length} bytes)`);

    // 2. Mock Optimization (Sharp Pipeline)
    console.log('\n--- STEP 2: Sharp Optimization Pipeline ---');
    const optimizedBuffer = await sharp(originalBuffer)
      .resize({ width: 100 })
      .webp({ quality: 50 })
      .toBuffer();
    console.log(`✅ Optimized image size: ${optimizedBuffer.length} bytes (Sharp process complete)`);

    // 3. Upload to Cloudinary
    console.log('\n--- STEP 3: Cloudinary Upload ---');
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'seekon-verification', format: 'webp' },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(optimizedBuffer);
    });
    testPublicId = uploadResult.public_id;
    console.log(`✅ Uploaded to Cloudinary successfully.`);
    console.log(`   URL: ${uploadResult.secure_url}`);
    console.log(`   Public ID: ${testPublicId}`);

    // 4. Save Metadata to MongoDB
    console.log('\n--- STEP 4: Metadata MongoDB Persistence ---');
    const mockStatus = new FlashStatus({
      mediaUrl: uploadResult.secure_url,
      mediaType: 'image',
      caption: 'Self-verification status update. Please ignore.',
      author: '254700000000@c.us',
      cloudinaryPublicId: testPublicId,
    });
    await mockStatus.save();
    testStatusId = mockStatus._id;
    console.log(`✅ Metadata persisted in MongoDB with ID: ${testStatusId}`);

    // 5. Mock Lifecycle deletion (Cleanup test run)
    console.log('\n--- STEP 5: Mock Lifecycle Deletion & Cleanup ---');
    console.log(`🧹 Deleting test asset from Cloudinary (${testPublicId})...`);
    const destroyResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(testPublicId, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
    console.log(`   Cloudinary destroy result: ${destroyResult.result}`);

    if (destroyResult.result === 'ok') {
      console.log(`🧹 Deleting metadata document from MongoDB (${testStatusId})...`);
      await FlashStatus.findByIdAndDelete(testStatusId);
      console.log('✅ Successfully removed status document from MongoDB.');
    } else {
      throw new Error(`Cloudinary destroy returned unexpected status: ${destroyResult.result}`);
    }

    console.log('\n======================================================');
    console.log('🎉 VERIFICATION PASSED: STATUS CMS ENGINE PIPELINE IS 100% OPERATIONAL!');
    console.log('======================================================');

  } catch (error) {
    console.error('\n❌ VERIFICATION FAILED:');
    console.error(error);
    
    // Emergency cleanup
    if (testPublicId) {
      try {
        console.log(`🧹 Emergency cleanup: deleting Cloudinary asset ${testPublicId}...`);
        await cloudinary.uploader.destroy(testPublicId);
      } catch (err) {
        console.error('Failed to cleanup Cloudinary asset:', err.message);
      }
    }
    if (testStatusId) {
      try {
        console.log(`🧹 Emergency cleanup: deleting MongoDB doc ${testStatusId}...`);
        await FlashStatus.findByIdAndDelete(testStatusId);
      } catch (err) {
        console.error('Failed to cleanup MongoDB document:', err.message);
      }
    }
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Mongoose connection closed.');
    process.exit(0);
  }
};

runVerification();
