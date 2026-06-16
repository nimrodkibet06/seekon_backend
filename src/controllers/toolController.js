import imglyRemoveBackground from '@imgly/background-removal-node';
import { uploadBufferToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import fs from 'fs';

/**
 * POST /api/tools/remove-bg
 * Accepts an image, processes background removal locally using @imgly/background-removal-node (AI),
 * uploads the transparent result to Cloudinary, and deletes the original image to save space.
 */
export const removeBackground = async (req, res) => {
  try {
    // 1. Get the uploaded file from request
    let file = null;
    if (req.file) {
      file = req.file;
    } else if (req.files && req.files.length > 0) {
      file = req.files[0];
    }

    if (!file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }

    let isCloudinaryUrl = file.path && (file.path.startsWith('http://') || file.path.startsWith('https://'));
    let imageSource = file.path; // Can be Cloudinary URL or local file path

    console.log(`🤖 Starting local background removal using @imgly/background-removal-node...`);
    console.log(`📂 Source: ${imageSource}`);

    let processedBuffer;
    try {
      // Run local AI background removal
      const processedBlob = await imglyRemoveBackground(imageSource, {
        model: 'small', // Use small model to keep resource footprint low on the VM
        output: {
          format: 'image/png' // Transparent output requires PNG
        }
      });

      const arrayBuffer = await processedBlob.arrayBuffer();
      processedBuffer = Buffer.from(arrayBuffer);
      console.log('✅ Local background removal successful!');
    } catch (aiError) {
      console.error('❌ Local AI background removal failed:', aiError.message);
      
      // Fallback: Upload and return original image so the user's upload flow doesn't break
      console.log('⚠️ Falling back to original image...');
      if (isCloudinaryUrl) {
        return res.status(200).json({
          success: true,
          message: `Background removal failed: ${aiError.message}. Original image returned.`,
          data: {
            url: file.path,
            publicId: file.filename
          }
        });
      } else {
        const { uploadToCloudinary } = await import('../config/cloudinary.js');
        const result = await uploadToCloudinary(file.path, 'seekon-apparel');
        return res.status(200).json({
          success: true,
          message: `Background removal failed: ${aiError.message}. Original image returned.`,
          data: {
            url: result.url,
            publicId: result.public_id
          }
        });
      }
    }

    // Upload processed transparent buffer to Cloudinary
    console.log('☁️ Uploading processed transparent image to Cloudinary...');
    const uploadResult = await uploadBufferToCloudinary(processedBuffer, 'seekon-apparel');
    console.log('✅ Uploaded to Cloudinary:', uploadResult.url);

    // Clean up original non-transparent file to save storage space
    if (isCloudinaryUrl) {
      try {
        console.log('🗑️ Deleting original non-transparent image from Cloudinary...');
        await deleteFromCloudinary(file.filename);
      } catch (delError) {
        console.warn('⚠️ Failed to delete original file from Cloudinary:', delError.message);
      }
    } else {
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup temp disk file:', cleanupError.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Background removed and uploaded successfully.',
      data: {
        url: uploadResult.url,
        publicId: uploadResult.public_id
      }
    });

  } catch (error) {
    console.error('🔥 Error in local background removal pipeline:', error);
    return res.status(500).json({ success: false, message: 'Internal server error during background removal' });
  }
};
