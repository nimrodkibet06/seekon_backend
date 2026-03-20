/**
 * Image Processing Worker
 * Runs separately to handle AI background removal with isolated memory
 * 
 * Usage: node src/workers/imageWorker.js
 * Or: npm run worker
 */

import axios from 'axios';
import removeBackground from '@imgly/background-removal-node';
import { uploadToCloudinary } from '../config/cloudinary.js';
import fs from 'fs';
import path from 'path';
import { getNextJob, completeJob, failJob, updateJobProgress } from '../queue/jobQueue.js';

const WORKER_INTERVAL_MS = 3000; // Check for new jobs every 3 seconds

// Temporary directory for worker files
const TEMP_DIR = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Download image from URL
 */
const downloadImage = async (url) => {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'arraybuffer'
  });
  return Buffer.from(response.data);
};

/**
 * Process a single job
 */
const processJob = async (job) => {
  const { id, data } = job;
  const { cloudinaryUrl, originalPublicId } = data;
  
  let tempInputPath = null;
  let tempOutputPath = null;
  
  try {
    console.log(`\n🔄 [Worker] Processing job ${id}`);
    console.log(`📥 [Worker] Downloading from: ${cloudinaryUrl}`);
    
    // Update progress
    updateJobProgress(id, 10, 'processing');
    
    // Download image
    const imageBuffer = await downloadImage(cloudinaryUrl);
    tempInputPath = path.join(TEMP_DIR, `input-${id}-${Date.now()}.png`);
    fs.writeFileSync(tempInputPath, imageBuffer);
    
    updateJobProgress(id, 30, 'processing');
    console.log(`🧠 [Worker] Running AI background removal...`);
    
    // Process with AI - using small model to minimize memory
    const aiConfig = { 
      model: 'small', 
      output: { format: 'image/png' }
    };
    
    const resultBlob = await removeBackground(tempInputPath, aiConfig);
    
    updateJobProgress(id, 70, 'processing');
    console.log(`💾 [Worker] Saving processed image...`);
    
    // Save AI output
    const arrayBuffer = await resultBlob.arrayBuffer();
    tempOutputPath = path.join(TEMP_DIR, `output-${id}-${Date.now()}.png`);
    fs.writeFileSync(tempOutputPath, Buffer.from(arrayBuffer));
    
    updateJobProgress(id, 85, 'processing');
    console.log(`☁️ [Worker] Uploading to Cloudinary...`);
    
    // Upload result to Cloudinary
    const result = await uploadToCloudinary(tempOutputPath, 'seekon-apparel');
    
    updateJobProgress(id, 100, 'completed');
    console.log(`✅ [Worker] Job ${id} complete! URL: ${result.url}`);
    
    // Return result
    return {
      url: result.url,
      publicId: result.public_id,
      originalPublicId
    };
    
  } catch (error) {
    console.error(`❌ [Worker] Job ${id} failed:`, error.message);
    throw error;
    
  } finally {
    // Aggressive cleanup
    try {
      if (tempInputPath && fs.existsSync(tempInputPath)) {
        fs.unlinkSync(tempInputPath);
      }
      if (tempOutputPath && fs.existsSync(tempOutputPath)) {
        fs.unlinkSync(tempOutputPath);
      }
      console.log(`🧹 [Worker] Cleaned up temp files for job ${id}`);
    } catch (cleanupError) {
      console.warn(`⚠️ [Worker] Cleanup warning:`, cleanupError.message);
    }
  }
};

/**
 * Main worker loop
 */
const startWorker = () => {
  console.log(`\n🚀====================================`);
  console.log(`   Image Processing Worker Started`);
  console.log(`   Checking every ${WORKER_INTERVAL_MS}ms`);
  console.log(`====================================🚀\n`);
  
  setInterval(async () => {
    try {
      const job = getNextJob();
      
      if (!job) {
        // No jobs to process
        return;
      }
      
      console.log(`\n📋 [Worker] Got job: ${job.id}`);
      
      const result = await processJob(job);
      completeJob(job.id, result);
      
    } catch (error) {
      console.error(`[Worker] Error processing job:`, error);
      // Job is already marked as failed in processJob
    }
  }, WORKER_INTERVAL_MS);
};

// Start worker if run directly
startWorker();

export { processJob, startWorker };
