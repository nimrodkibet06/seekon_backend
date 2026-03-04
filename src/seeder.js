import mongoose from 'mongoose';
import dotenv from 'dotenv';
import products from './data/products.js';
import Product from './models/Product.js';
import User from './models/User.js';

dotenv.config();

const importData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { family: 4 });

    // 1. Clear existing data to avoid duplicates
    await Product.deleteMany();
    // await User.deleteMany(); // Uncomment if you want to clear users too

    // 2. Insert new products
    /* Optional: Assign all products to the first admin user found
    const adminUser = await User.findOne({ role: 'admin' });
    const sampleProducts = products.map((p) => {
      return { ...p, user: adminUser._id };
    }); */
    
    await Product.insertMany(products);

    console.log('✅ Data Imported!');
    process.exit();
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { family: 4 });
    await Product.deleteMany();
    console.log('🔥 Data Destroyed!');
    process.exit();
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}