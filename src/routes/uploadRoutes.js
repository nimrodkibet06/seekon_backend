import express from 'express';
import { uploadFile, deleteFile } from '../controllers/uploadController.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploadMultiple } from '../middleware/upload.js';

const router = express.Router();

// @route   POST /api/upload
// @desc    Upload file(s) to Cloudinary with AI background removal
// @access  Private
router.post('/', authMiddleware, uploadMultiple, uploadFile);

// @route   DELETE /api/upload/:publicId
// @desc    Delete file from Cloudinary
// @access  Private
router.delete('/:publicId', authMiddleware, deleteFile);

export default router;
