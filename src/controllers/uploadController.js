import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import fs from 'fs';

export const uploadFile = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

  const localFilePath = req.file.path;

  try {
    console.log('Uploading client-processed image to Cloudinary...');
    const result = await uploadToCloudinary(localFilePath, 'seekon-apparel');

    // Cleanup temporary disk file
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      data: { url: result.url, publicId: result.public_id }
    });
  } catch (error) {
    console.error('Upload Pipeline Error:', error);
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    res.status(500).json({ success: false, message: 'Upload failed' });
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
