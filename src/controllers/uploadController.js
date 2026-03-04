import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import removeBackground from '@imgly/background-removal-node';
import fs from 'fs';

/**
 * @route   POST /api/upload
 * @desc    Upload file to Cloudinary with local AI background removal
 * @access  Private
 */
export const uploadFile = async (req, res) => {
  let localFilePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    localFilePath = req.file.path;
    console.log('Processing image with local AI background removal:', localFilePath);

    // 1. Process the image locally using the free AI
    const blob = await removeBackground(localFilePath);

    // 2. Convert the output to a Base64 string for Cloudinary
    const buffer = Buffer.from(await blob.arrayBuffer());
    const dataURL = `data:image/png;base64,${buffer.toString("base64")}`;

    // 3. Upload the transparent PNG to Cloudinary
    const result = await uploadToCloudinary(dataURL, 'seekon-apparel');

    // 4. Delete the temporary raw image from the server
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
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
    console.error('Upload error details:', error);
    
    // Cleanup on fail
    if (localFilePath && fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Image processing failed'
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




