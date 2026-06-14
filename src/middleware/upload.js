import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { isServiceConfigured } from '../config/checkEnv.js';

// Import cloudinary config to ensure it runs config setup
import '../config/cloudinary.js';

const cloudinaryConfigured = isServiceConfigured('cloudinary');
let storage;

if (cloudinaryConfigured) {
  console.log('☁️  Multer configured with Direct-to-Cloudinary (memory-free) streaming storage');
  storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'seekon-apparel',
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
      public_id: (req, file) => {
        const originalName = file.originalname.replace(/\.[^/.]+$/, "");
        // Clean special characters from name
        const cleanName = originalName.replace(/[^a-zA-Z0-9_-]/g, "_");
        return `seekon-${cleanName}-${Date.now()}`;
      }
    }
  });
} else {
  console.warn('⚠️  Multer configured with DiskStorage fallback (Cloudinary credentials missing)');
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, os.tmpdir());
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  });
}

// File filter function for local fallback
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
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: cloudinaryConfigured ? undefined : fileFilter // CloudinaryStorage handles allowed_formats
});

// Export separate upload instances for single and multiple files
export const uploadSingle = upload.single('image');
export const uploadMultiple = upload.array('images', 10); // Max 10 files, field name 'images'
