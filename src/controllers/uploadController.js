import { uploadToCloudinary } from '../config/cloudinary.js';
import fs from 'fs';

export const uploadFile = async (req, res) => {
  try {
    // 1. Multer Catch-All
    let files = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        files = req.files;
      } else {
        files = [
          ...(req.files.image || []), 
          ...(req.files.images || []),
          ...(req.files.file || []), 
          ...(req.files.files || [])
        ];
      }
    } else if (req.file) {
      files = [req.file];
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid files found.' });
    }

    const uploadedImages = [];

    // 2. Direct Sequential Cloudinary Upload (No AI, No Workers)
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        console.log(`[${i + 1}/${files.length}] Uploading direct to Cloudinary: ${file.originalname}`);
        const result = await uploadToCloudinary(file.path, 'seekon-apparel');
        uploadedImages.push({ url: result.url, publicId: result.public_id });
      } catch (err) {
        console.error(`Error uploading ${file.originalname}:`, err.message);
      } finally {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Images uploaded successfully',
      data: uploadedImages
    });

  } catch (error) {
    console.error('Upload pipeline error:', error);
    return res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// Keep deleteFile for backwards compatibility
export const deleteFile = async (req, res) => {
  try {
    const { publicId } = req.params;
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Public ID is required'
      });
    }
    const { deleteFromCloudinary } = await import('../config/cloudinary.js');
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
