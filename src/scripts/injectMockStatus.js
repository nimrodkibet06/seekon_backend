import dotenv from 'dotenv';
import mongoose from 'mongoose';
import FlashStatus from '../models/FlashStatus.js';

// Load environment variables
dotenv.config();

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
  if (!mongoUri) {
    throw new Error('Neither MONGO_URI nor DATABASE_URL environment variable is defined!');
  }
  await mongoose.connect(mongoUri, { family: 4 });
  console.log('✅ Connected to MongoDB.');
};

const injectMockStatus = async () => {
  try {
    await connectDB();

    console.log('🚀 Injecting high-fidelity mock Status Update into MongoDB...');

    // Mock status entry using a premium Seekon-related Unsplash image
    const mockStatus = new FlashStatus({
      mediaUrl: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?q=80&w=1000&auto=format&fit=crop',
      mediaType: 'image',
      caption: '🔥 NEW DROP: Seekon Oversized Premium Cotton Hoodies now available. Scan the WhatsApp button below to order! KSh 2,500.',
      author: '254712345678@c.us',
      cloudinaryPublicId: 'seekon_mock_status_hoodie', // Placeholder for mock cleanup
      createdAt: new Date() // Set to now so it is active for 24h
    });

    await mockStatus.save();

    console.log('\n======================================================');
    console.log('🎉 MOCK STATUS INJECTED SUCCESSFULLY!');
    console.log(`   ID: ${mockStatus._id}`);
    console.log(`   Media URL: ${mockStatus.mediaUrl}`);
    console.log(`   Caption: "${mockStatus.caption}"`);
    console.log('======================================================');
    console.log('👉 Open your browser now. The Live Drops tray and Navbar button will be visible!');

  } catch (error) {
    console.error('❌ Failed to inject mock status:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Connection closed.');
    process.exit(0);
  }
};

injectMockStatus();
