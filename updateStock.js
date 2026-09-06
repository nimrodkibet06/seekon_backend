import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './src/models/Product.js';

dotenv.config();

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const STOCK_COUNT = 200;

if (!mongoUri) {
  console.error('❌ Set MONGO_URI or MONGODB_URI in .env');
  process.exit(1);
}

try {
  await mongoose.connect(mongoUri);
  const result = await Product.updateMany(
    {},
    { $set: { stock: STOCK_COUNT, inStock: true } }
  );
  console.log(`✅ Set stock to ${STOCK_COUNT} for ${result.modifiedCount} product(s) (${result.matchedCount} matched)`);
  await mongoose.disconnect();
  process.exit(0);
} catch (error) {
  console.error('❌ Error updating stock:', error.message);
  process.exit(1);
}
