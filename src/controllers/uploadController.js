import { removeBackground } from '@imgly/background-removal-node';
import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import fs from 'fs';
import path from 'path';

export const uploadFile = async (req, res) => {
  let localFilePath = null;
  let processedFilePath = null;

  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    localFilePath = req.file.path;
    console.log('1. Processing image with Server-Side AI (Small Model)...');

    // Force the lightweight model to protect RAM
    const aiConfig = {
      model: 'small',
      output: { format: 'image/png' }
    };

    const imageBuffer = fs.readFileSync(localFilePath);
    const imageBlob = new Blob([imageBuffer], { type: req.file.mimetype });
    
    // Run the AI 
    const resultBlob = await removeBackground(imageBlob, aiConfig);
    
    // Save the transparent result
    const arrayBuffer = await resultBlob.arrayBuffer();
    processedFilePath = path.join(path.dirname(localFilePath), `no-bg-${Date.now()}.png`);
    fs.writeFileSync(processedFilePath, Buffer.from(arrayBuffer));

    console.log('2. AI complete. Uploading to Cloudinary...');
    const result = await uploadToCloudinary(processedFilePath, 'seekon-apparel');

    // Aggressive Cleanup
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    if (fs.existsSync(processedFilePath)) fs.unlinkSync(processedFilePath);

    res.status(200).json({
      success: true,
      message: 'Background removed and uploaded successfully',
      data: { url: result.url, publicId: result.public_id }
    });

  } catch (error) {
    console.error('Server AI Error:', error);
    if (localFilePath && fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    if (processedFilePath && fs.existsSync(processedFilePath)) fs.unlinkSync(processedFilePath);
    res.status(500).json({ success: false, message: 'Image processing failed' });
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
