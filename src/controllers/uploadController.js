import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import removeBackground from '@imgly/background-removal-node';
import fs from 'fs';
import path from 'path';

/**
 * @route   POST /api/upload
 * @desc    Upload file to Cloudinary with local AI background removal (OOM-optimized)
 * @access  Private
 */
export const uploadFile = async (req, res) => {
  let localFilePath = null;
  let processedFilePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    localFilePath = req.file.path;
    console.log('Processing image with local AI (Small Model)...');

    // 1. Configure AI for Low-Memory Environments
    const aiConfig = {
      model: 'small', // CRITICAL: Uses ~40MB RAM instead of ~100MB+
      output: { format: 'image/png' }
    };

    // 2. Process image with small model to prevent OOM
    const resultBlob = await removeBackground(localFilePath, aiConfig);
    
    // 3. Save processed transparent PNG locally
    const arrayBuffer = await resultBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    processedFilePath = path.join(path.dirname(localFilePath), `no-bg-${Date.now()}.png`);
    fs.writeFileSync(processedFilePath, buffer);

    // Free memory from blob
    resultBlob.close?.();

    console.log('AI processing complete. Uploading to Cloudinary...');

    // 4. Upload the final transparent image to Cloudinary
    const result = await uploadToCloudinary(processedFilePath, 'seekon-apparel');

    // 5. Aggressive Cleanup (Free Disk & Memory instantly)
    if (localFilePath && fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    if (processedFilePath && fs.existsSync(processedFilePath)) fs.unlinkSync(processedFilePath);

    // Force garbage collection hint (Node.js will GC when needed)
    if (global.gc) {
      global.gc();
    }

    res.status(200).json({
      success: true,
      message: 'Image processed and uploaded successfully',
      data: {
        url: result.url,
        publicId: result.public_id
      }
    });
  } catch (error) {
    console.error('Upload/AI error details:', error);
    
    // Ensure temporary files are deleted even if it fails
    if (localFilePath && fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    if (processedFilePath && fs.existsSync(processedFilePath)) fs.unlinkSync(processedFilePath);

    res.status(500).json({
      success: false,
      message: 'Image processing failed. Server memory might be full.'
    });
  }
};

/**
 * @route   DELETE /api/upload/:publicId
 * @desc    Delete file from Cloudinary
 * @access  Private
 */
export const deleteFile = async (req, res) => {
  try {
    const { publicId } = req.params;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Public ID is required'
      });
    }

    await deleteFromCloudinary(publicId);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
