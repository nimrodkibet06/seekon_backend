import 'dotenv/config';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import path from 'path';

// Import models using dynamic import
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const Order = (await import('../models/Order.js')).default;
const Transaction = (await import('../models/Transaction.js')).default;
const Cart = (await import('../models/Cart.js')).default;
const Wishlist = (await import('../models/Wishlist.js')).default;

const cleanData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected...');

    // Wipe transactional data
    await Order.deleteMany({});
    await Transaction.deleteMany({});
    await Cart.deleteMany({});
    await Wishlist.deleteMany({});

    console.log('✅ Test Orders, Transactions, Carts, and Wishlists successfully wiped!');
    console.log('✅ Users, Products, and Categories preserved.');
    
    await mongoose.disconnect();
    console.log('MongoDB Disconnected...');
    process.exit();
  } catch (error) {
    console.error('Error wiping data:', error);
    process.exit(1);
  }
};

cleanData();
