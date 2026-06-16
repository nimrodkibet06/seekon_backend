import imglyRemoveBackground from '@imgly/background-removal-node';
import { uploadBufferToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import axios from 'axios';
import fs from 'fs';

/**
 * Helper to upload the original file to Cloudinary and return it in case of skip/fail
 */
const uploadOriginalAndReturn = async (file, isCloudinaryUrl, res, reason) => {
  console.log(`⚠️ Falling back to original image because: ${reason}`);
  if (isCloudinaryUrl) {
    return res.status(200).json({
      success: true,
      message: `Background removal skipped/failed (${reason}). Original image returned.`,
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
      message: `Background removal skipped/failed (${reason}). Original image returned.`,
      data: {
        url: result.url,
        publicId: result.public_id
      }
    });
  }
};

/**
 * POST /api/tools/remove-bg
 * Accepts an image, processes background removal, and uploads result to Cloudinary.
 * - MODE A (Recommended): Fast Cloud API if REMOVE_BG_API_KEY is present (1-2s, non-blocking).
 * - MODE B: Local AI model if API key is absent (blocks Node thread, slow on small VMs).
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
    const removeBgApiKey = process.env.REMOVE_BG_API_KEY;

    let processedBuffer;

    if (removeBgApiKey) {
      // MODE A: Fast Cloud API (Takes 1-2s, uses 0% local CPU/RAM)
      console.log('🤖 REMOVE_BG_API_KEY is configured. Processing background removal via remove.bg cloud API...');
      
      let requestPayload = {};
      if (isCloudinaryUrl) {
        requestPayload = {
          image_url: file.path,
          size: 'auto'
        };
      } else {
        const fileBuffer = fs.readFileSync(file.path);
        requestPayload = {
          image_file_b64: fileBuffer.toString('base64'),
          size: 'auto'
        };
      }

      try {
        const response = await axios.post('https://api.remove.bg/v1.0/removebg', requestPayload, {
          headers: {
            'X-Api-Key': removeBgApiKey,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        });
        processedBuffer = Buffer.from(response.data);
        console.log('✅ Cloud API background removal successful!');
      } catch (apiError) {
        let errorMsg = apiError.message;
        if (apiError.response && apiError.response.data) {
          try {
            const errorJson = JSON.parse(Buffer.from(apiError.response.data).toString('utf8'));
            if (errorJson.errors && errorJson.errors.length > 0) {
              errorMsg = errorJson.errors.map(e => e.title).join(', ');
            }
          } catch (e) {
            errorMsg = Buffer.from(apiError.response.data).toString('utf8');
          }
        }
        console.error('❌ Cloud API background removal failed:', errorMsg);
        return uploadOriginalAndReturn(file, isCloudinaryUrl, res, `Cloud API failed: ${errorMsg}`);
      }
    } else {
      // MODE B: Local AI model (Takes 40-90s, blocks single Node.js thread, high VM overhead)
      console.log('🤖 REMOVE_BG_API_KEY is not configured. Processing locally via @imgly/background-removal-node...');
      console.warn('⚠️ WARNING: Local AI processing blocks the Node.js event loop and can cause Nginx timeouts (504 Gateway Timeout) on smaller VMs.');
      
      try {
        const processedBlob = await imglyRemoveBackground(file.path, {
          model: 'small',
          output: {
            format: 'image/png'
          }
        });
        const arrayBuffer = await processedBlob.arrayBuffer();
        processedBuffer = Buffer.from(arrayBuffer);
        console.log('✅ Local background removal successful!');
      } catch (aiError) {
        console.error('❌ Local AI background removal failed:', aiError.message);
        return uploadOriginalAndReturn(file, isCloudinaryUrl, res, `Local AI failed: ${aiError.message}`);
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
    console.error('🔥 Error in background removal pipeline:', error);
    return res.status(500).json({ success: false, message: 'Internal server error during background removal' });
  }
};
