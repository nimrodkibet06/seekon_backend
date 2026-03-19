import express from 'express';
import { uploadFile, deleteFile } from '../controllers/uploadController.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploadMultiple, uploadSingle } from '../middleware/upload.js';

const router = express.Router();

// @route   POST /api/upload
// @desc    Upload file(s) to Cloudinary with AI background removal
// @access  Private
// Try multiple first, fall back to single if needed
router.post('/', authMiddleware, (req, res, next) => {
  uploadMultiple(req, res, function(err) {
    if (err) {
      // Multer error - try single upload
      uploadSingle(req, res, next);
    } else {
      next();
    }
  });
}, uploadFile);

// @route   DELETE /api/upload/:publicId
// @desc    Delete file from Cloudinary
// @access  Private
router.delete('/:publicId', authMiddleware, deleteFile);

export default router;
