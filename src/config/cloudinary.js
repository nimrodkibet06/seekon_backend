import { v2 as cloudinary } from 'cloudinary';
import { isServiceConfigured, getMissingConfig } from './checkEnv.js';

// Check if Cloudinary is configured
const cloudinaryConfigured = isServiceConfigured('cloudinary');

if (cloudinaryConfigured) {
  /**
   * Configure Cloudinary for file uploads
   */
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('✅ Cloudinary configured successfully');
} else {
  const missing = getMissingConfig('cloudinary');
  console.warn('⚠️  Cloudinary is not configured - image uploads will be disabled');
  if (missing.length > 0) {
    console.warn('   Missing configuration:');
    missing.forEach(({ name }) => {
      console.warn(`   - ${name}`);
    });
  }
}

/**
 * Upload file to Cloudinary
 * @param {String} filePath - Path to the file to upload (can be file path or data URL)
 * @param {String} folder - Folder name in Cloudinary
 * @returns {Object} Upload result with URL
 */
export const uploadToCloudinary = async (filePath, folder = 'seekon-apparel') => {
  if (!cloudinaryConfigured) {
    throw new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.');
  }
  
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: 'auto',
    });
    return {
      url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    throw new Error(`Cloudinary upload failed: ${error.message}`);
  }
};

/**
 * Upload file buffer to Cloudinary using upload_stream
 * @param {Buffer} fileBuffer - Buffer of the file to upload
 * @param {String} folder - Folder name in Cloudinary
 * @returns {Object} Upload result with URL
 */
export const uploadBufferToCloudinary = async (fileBuffer, folder = 'seekon-apparel') => {
  if (!cloudinaryConfigured) {
    throw new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.');
  }
  
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) {
          reject(new Error(`Cloudinary upload stream failed: ${error.message}`));
        } else {
          resolve({
            url: result.secure_url,
            public_id: result.public_id,
          });
        }
      }
    );
    uploadStream.end(fileBuffer);
  });
};

/**
 * Delete file from Cloudinary
 * @param {String} publicId - Public ID of the file to delete
 */
export const deleteFromCloudinary = async (publicId) => {
  if (!cloudinaryConfigured) {
    console.warn('⚠️  Cloudinary is not configured - cannot delete file');
    return;
  }
  
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    throw new Error(`Cloudinary delete failed: ${error.message}`);
  }
};

export default cloudinary;




