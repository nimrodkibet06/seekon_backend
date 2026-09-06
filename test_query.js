import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './src/models/Product.js';

dotenv.config();

try {
  await mongoose.connect(process.env.MONGO_URI, { family: 4 });
  const brands = await Product.distinct('brand');
  const categories = await Product.distinct('category');

  console.log('UNIQUE_BRANDS:', JSON.stringify(brands));
  console.log('UNIQUE_CATEGORIES:', JSON.stringify(categories));
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
