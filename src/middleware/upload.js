import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Configure Multer for file uploads using disk storage
 * Files are saved temporarily to OS temp directory to prevent memory issues
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir()); // Use OS temp directory to prevent OOM
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

/**
 * Multer middleware configuration
 */
export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

// Export separate upload instances for single and multiple files
export const uploadSingle = upload.single('image');
export const uploadMultiple = upload.array('images', 10); // Max 10 files, field name 'images'
