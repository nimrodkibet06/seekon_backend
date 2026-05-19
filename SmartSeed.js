import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
import Product from './src/models/Product.js';
import productsData from './data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const imageDirectory = path.join(__dirname, 'bulk-images');

async function smartUpload() {
  if (!mongoUri) {
    console.error('❌ Set MONGO_URI or MONGODB_URI in your .env file');
    process.exit(1);
  }

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('❌ Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected well and successfully!');

    console.log(`Starting smart upload for ${productsData.length} products...`);

    for (const item of productsData) {
      const filesToProcess = item.fileNames || [];
      const uploadedImageUrls = [];

      for (const file of filesToProcess) {
        const filePath = path.join(imageDirectory, file);

        if (!fs.existsSync(filePath)) {
          console.log(`⚠️ Warning: Image ${file} not found in bulk-images folder. Skipping...`);
          continue;
        }

        console.log(`Uploading ${file} to Cloudinary...`);
        const cloudResult = await cloudinary.uploader.upload(filePath, {
          folder: 'seekon_products',
        });

        uploadedImageUrls.push(cloudResult.secure_url);
      }

      if (uploadedImageUrls.length === 0) {
        console.log(`⚠️ Skipping ${item.name}: no images uploaded`);
        continue;
      }

      const newProduct = new Product({
        name: item.name,
        description: item.description,
        category: item.category,
        brand: item.brand,
        subCategory: item.subcategory || item.subCategory || '',
        price: item.price,
        sizes: item.sizes,
        colors: item.colors,
        image: uploadedImageUrls[0],
        images: uploadedImageUrls,
        isFeatured: Boolean(item.featuredProduct),
        newProduct: Boolean(item.newArrival),
        isFlashSale: Boolean(item.flashSale),
        stock: 200,
        inStock: true,
      });

      await newProduct.save();
      console.log(`✅ Saved: ${item.name} with ${uploadedImageUrls.length} image(s)`);
    }

    console.log('🎉 All products uploaded successfully!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error during upload:', error);
    process.exit(1);
  }
}

smartUpload();
