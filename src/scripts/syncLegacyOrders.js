import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';

// Load environment variables from .env file
dotenv.config();

const syncLegacyOrders = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    
    if (!mongoUri) {
      console.error('❌ MONGO_URI is missing from .env file');
      process.exit(1);
    }

    console.log('⏳ Connecting to MongoDB...');
    await mongoose.connect(mongoUri, { 
      family: 4,
      serverSelectionTimeoutMS: 5000 
    });
    console.log('✅ Connected to MongoDB');

    // Fetch all registered users
    const users = await User.find({});
    console.log(`🔍 Found ${users.length} users in the database.`);
    console.log('🚀 Starting legacy order synchronization...');

    let totalClaimed = 0;
    let usersWithClaimedOrders = 0;

    for (const user of users) {
      const email = user.email.toLowerCase().trim();
      
      // Find orders that belong to this email but aren't linked to a user account
      // We check multiple possible email fields and guest checkout status
      const query = {
        $and: [
          {
            $or: [
              { guestEmail: email },
              { contactEmail: email },
              { userEmail: email },
              { "shippingAddress.email": email }
            ]
          },
          {
            $or: [
              { user: { $exists: false } },
              { user: null },
              { isGuestCheckout: true }
            ]
          }
        ]
      };

      const result = await Order.updateMany(query, {
        $set: {
          user: user._id,
          isGuestCheckout: false
        }
      });

      if (result.modifiedCount > 0) {
        console.log(`🔗 Linked ${result.modifiedCount} legacy order(s) to user: ${email} (${user.name})`);
        totalClaimed += result.modifiedCount;
        usersWithClaimedOrders++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Total Orders Reclaimed: ${totalClaimed}`);
    console.log(`👤 Users who gained orders: ${usersWithClaimedOrders}`);
    console.log('='.repeat(50));

    await mongoose.connection.close();
    console.log('👋 Database connection closed. Exiting...');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed with error:');
    console.error(error);
    
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
};

// Execute the migration
syncLegacyOrders();
