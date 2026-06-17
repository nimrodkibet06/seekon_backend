import { Worker } from 'bullmq';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import Product from '../models/Product.js';
import { uploadToCloudinary } from '../config/cloudinary.js';
import { getRedisConnectionOptions } from '../config/redis.js';
import imglyRemoveBackground from '@imgly/background-removal-node';
import axios from 'axios';

const finalDir = path.join(process.cwd(), 'uploads', 'final');

// Ensure processing directories exist
if (!fs.existsSync(finalDir)) {
  fs.mkdirSync(finalDir, { recursive: true });
}

const connection = getRedisConnectionOptions();

const worker = new Worker('imageQueue', async (job) => {
  const { productId, imagePaths, runAIBackgroundRemoval } = job.data;
  console.log(`🚀 [IMAGE WORKER] Processing job ${job.id} for Product: ${productId} (AI Background Removal: ${runAIBackgroundRemoval})`);

  const cloudinaryUrls = [];

  // Loop through image paths sequentially (for...of, not Promise.all)
  for (const [index, rawPath] of imagePaths.entries()) {
    // 0. If background removal is requested, process it first
    if (runAIBackgroundRemoval) {
      try {
        console.log(`🤖 [IMAGE WORKER] Processing AI background removal for: ${rawPath}`);
        const removeBgApiKey = process.env.REMOVE_BG_API_KEY;
        let processedBuffer;
        
        if (removeBgApiKey) {
          // Cloud API (Fast)
          const fileBuffer = fs.readFileSync(rawPath);
          const response = await axios.post('https://api.remove.bg/v1.0/removebg', {
            image_file_b64: fileBuffer.toString('base64'),
            size: 'auto'
          }, {
            headers: {
              'X-Api-Key': removeBgApiKey,
              'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer'
          });
          processedBuffer = Buffer.from(response.data);
          console.log(`✅ [IMAGE WORKER] Cloud API background removal success for ${rawPath}`);
        } else {
          // Local AI model (Slow, but safe in background worker)
          console.log(`🤖 [IMAGE WORKER] Local AI background removal running for ${rawPath}...`);
          const processedBlob = await imglyRemoveBackground(rawPath, {
            model: 'small',
            output: { format: 'image/png' }
          });
          const arrayBuffer = await processedBlob.arrayBuffer();
          processedBuffer = Buffer.from(arrayBuffer);
          console.log(`✅ [IMAGE WORKER] Local AI background removal success for ${rawPath}`);
        }
        
        // Overwrite the raw path with the processed image data
        fs.writeFileSync(rawPath, processedBuffer);
      } catch (bgRemovalError) {
        console.error(`⚠️ [IMAGE WORKER] AI Background removal failed for ${rawPath}, falling back to original:`, bgRemovalError.message);
      }
    }

    const filename = path.basename(rawPath, path.extname(rawPath));
    const compressedPath = path.join(finalDir, `${filename}-${Date.now()}.webp`);
    
    try {
      // 1. Process and compress the raw image using sharp (resize to max 1200px and compress to webp 80%)
      await sharp(rawPath)
        .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(compressedPath);

      console.log(`✅ [IMAGE WORKER] Image resized and compressed: ${compressedPath}`);
      
      // Update job progress (e.g., progress bar tracking)
      const progressPercent = Math.round(((index + 0.5) / imagePaths.length) * 100);
      await job.updateProgress(progressPercent);
      
    } catch (sharpError) {
      console.error(`❌ [IMAGE WORKER] Sharp processing failed for ${rawPath}:`, sharpError.message);
      // Clean up the raw file even if sharp failed
      try {
        if (fs.existsSync(rawPath)) {
          fs.unlinkSync(rawPath);
        }
      } catch (e) {
        console.warn(`⚠️ [IMAGE WORKER] Failed to delete raw file ${rawPath}:`, e.message);
      }
      continue; // Skip to next image
    }

    // 2. Delete raw file instantly after sharp processing is complete
    try {
      if (fs.existsSync(rawPath)) {
        fs.unlinkSync(rawPath);
        console.log(`🗑️ [IMAGE WORKER] Raw image deleted from queue: ${rawPath}`);
      }
    } catch (cleanupErr) {
      console.warn(`⚠️ [IMAGE WORKER] Failed to delete raw file ${rawPath}:`, cleanupErr.message);
    }

    // 3. Upload the compressed image to Cloudinary
    let uploadResult;
    try {
      uploadResult = await uploadToCloudinary(compressedPath, 'seekon-apparel');
      cloudinaryUrls.push(uploadResult.url);
      console.log(`☁️ [IMAGE WORKER] Uploaded to Cloudinary: ${uploadResult.url}`);
      
      // Update job progress
      const progressPercent = Math.round(((index + 1) / imagePaths.length) * 100);
      await job.updateProgress(progressPercent);
    } catch (uploadError) {
      console.error(`❌ [IMAGE WORKER] Cloudinary upload failed for ${compressedPath}:`, uploadError.message);
      // Ensure the compressed file is cleaned up even on upload failure
      try {
        if (fs.existsSync(compressedPath)) {
          fs.unlinkSync(compressedPath);
        }
      } catch (e) {
        console.warn(`⚠️ [IMAGE WORKER] Failed to delete compressed file ${compressedPath}:`, e.message);
      }
    }

    // 4. Ensure compressed file is deleted after upload step (already handled by uploadToCloudinary, but we add a fallback check)
    try {
      if (fs.existsSync(compressedPath)) {
        fs.unlinkSync(compressedPath);
        console.log(`🗑️ [IMAGE WORKER] Compressed image deleted from final: ${compressedPath}`);
      }
    } catch (cleanupErr) {
      // Ignore if already deleted by uploadToCloudinary
    }
  }

  // 5. Update MongoDB Product document once the loop finishes
  if (cloudinaryUrls.length > 0) {
    const mainImage = cloudinaryUrls[0];
    const updateResult = await Product.findByIdAndUpdate(
      productId,
      {
        image: mainImage,
        images: cloudinaryUrls,
        status: 'active'
      },
      { new: true }
    );
    console.log(`🎉 [IMAGE WORKER] Product ${productId} updated to 'active' status with ${cloudinaryUrls.length} images`);
  } else {
    // If no images succeeded, mark status as inactive or failed
    await Product.findByIdAndUpdate(productId, { status: 'inactive' });
    console.log(`❌ [IMAGE WORKER] Job finished but no images succeeded. Product ${productId} marked as 'inactive'`);
  }
}, {
  connection,
  concurrency: 1
});

worker.on('failed', (job, err) => {
  console.error(`🚨 [IMAGE WORKER] Job ${job?.id} failed with error:`, err.message);
});

export default worker;
