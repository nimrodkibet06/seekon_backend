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

    // 2. Direct Sequential Cloudinary Upload / Verification
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (file.path && (file.path.startsWith('http://') || file.path.startsWith('https://'))) {
          // File was streamed directly to Cloudinary by multer-storage-cloudinary
          console.log(`[${i + 1}/${files.length}] File already uploaded directly to Cloudinary: ${file.originalname}`);
          uploadedImages.push({ url: file.path, publicId: file.filename });
        } else {
          // Fallback path if it was saved locally to disk
          console.log(`[${i + 1}/${files.length}] Uploading from disk to Cloudinary: ${file.originalname}`);
          const result = await uploadToCloudinary(file.path, 'seekon-apparel');
          uploadedImages.push({ url: result.url, publicId: result.public_id });
        }
      } catch (err) {
        console.error(`Error uploading ${file.originalname}:`, err.message);
      } finally {
        // Only attempt to unlink if it is a local file path
        if (file.path && !file.path.startsWith('http://') && !file.path.startsWith('https://')) {
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (cleanupError) {
            console.warn('⚠️ Failed to cleanup temp file:', cleanupError.message);
          }
        }
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
