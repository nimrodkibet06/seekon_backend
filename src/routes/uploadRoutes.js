import express from 'express';
import multer from 'multer';
import { uploadFile, deleteFile, getUploadStatus } from '../controllers/uploadController.js';
import { authMiddleware } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// Create the Multer configuration with all possible field names
const multerUpload = upload.fields([
  { name: 'image', maxCount: 10 }, 
  { name: 'images', maxCount: 10 },
  { name: 'file', maxCount: 10 },    // Added for compatibility
  { name: 'files', maxCount: 10 }    // Added for compatibility
]);

// The Interceptor Middleware to catch hidden Multer errors
const uploadInterceptor = (req, res, next) => {
  multerUpload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      // A Multer-specific error occurred (e.g., File too large, unexpected field)
      console.error("🚨 [MULTER ERROR CAUGHT]:", err.code, err.message, err.field);
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    } else if (err) {
      // An unknown error occurred
      console.error("🚨 [UNKNOWN UPLOAD ERROR]:", err);
      return res.status(400).json({ success: false, message: 'An unknown upload error occurred' });
    }
    
    // Log the payload size to ensure it arrived safely
    console.log(`📦 [UPLOAD SUCCESS]: Received request with payload size:`, req.headers['content-length'], 'bytes');
    console.log('📦 [FILES RECEIVED]:', req.files);
    
    // Everything went fine, pass it to the controller!
    next();
  });
};

// @route   POST /api/upload
// @desc    Upload file(s) to Cloudinary with AI background removal
// @access  Private
router.post('/', authMiddleware, uploadInterceptor, uploadFile);

// @route   DELETE /api/upload/:publicId
// @desc    Delete file from Cloudinary
// @access  Private
router.delete('/:publicId', authMiddleware, deleteFile);

// @route   GET /api/upload/status/:jobId
// @desc    Get background removal job status
// @access  Private
router.get('/status/:jobId', authMiddleware, getUploadStatus);

export default router;
