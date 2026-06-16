import express from 'express';
import multer from 'multer';
import { removeBackground } from '../controllers/toolController.js';
import { authMiddleware } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// Use upload.any() to dynamically capture any uploaded file field names (like 'file' or 'image')
const multerUpload = upload.any();

// Interceptor middleware to capture Multer-specific errors
const uploadInterceptor = (req, res, next) => {
  multerUpload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error("🚨 [MULTER ERROR CAUGHT IN TOOLS]:", err.code, err.message, err.field);
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    } else if (err) {
      console.error("🚨 [UNKNOWN UPLOAD ERROR IN TOOLS]:", err);
      return res.status(400).json({ success: false, message: 'An unknown upload error occurred' });
    }
    
    console.log(`📦 [TOOL UPLOAD SUCCESS]: Received request with payload size:`, req.headers['content-length'], 'bytes');
    next();
  });
};

// @route   POST /api/tools/remove-bg
// @desc    Remove background from an uploaded image and upload clean result to Cloudinary
// @access  Private
router.post('/remove-bg', authMiddleware, uploadInterceptor, removeBackground);

export default router;
