import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import fs from 'fs';

// Helper to wait during cold starts
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const uploadFile = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

  const localFilePath = req.file.path;
  let finalFilePath = localFilePath; 

  try {
    console.log('1. Sending image to Hugging Face API...');
    const imageBuffer = fs.readFileSync(localFilePath);
    
    // Attempt 1
    let response = await fetch("https://router.huggingface.co/hf-inference/models/briaai/RMBG-1.4", {
      headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` },
      method: "POST",
      body: imageBuffer,
    });

    // Handle the "Cold Start" (Model is loading)
    if (response.status === 503) {
      console.log('⏳ Model is sleeping. Waiting 15 seconds for it to wake up...');
      await delay(15000);
      console.log('🔄 Retrying Hugging Face API...');
      response = await fetch("https://router.huggingface.co/hf-inference/models/briaai/RMBG-1.4", {
        headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` },
        method: "POST",
        body: imageBuffer,
      });
    }

    if (response.ok) {
      console.log('2. Hugging Face Success! Saving transparent image locally...');
      const transparentBuffer = await response.arrayBuffer();
      finalFilePath = `${localFilePath}-nobg.png`;
      fs.writeFileSync(finalFilePath, Buffer.from(transparentBuffer));
    } else {
      // CRITICAL: Get the actual error message
      const errorText = await response.text();
      console.error(`⚠️ Hugging Face Failed! Status: ${response.status}`);
      console.error(`⚠️ Error Details: ${errorText}`);
      console.log('Falling back to original image.');
    }

    console.log('3. Uploading final image to Cloudinary...');
    const result = await uploadToCloudinary(finalFilePath, 'seekon-apparel');

    // Cleanup
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    if (finalFilePath !== localFilePath && fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath);

    res.status(200).json({
      success: true,
      message: response.ok ? 'Image processed and uploaded' : 'Uploaded original image (AI unavailable)',
      data: { url: result.url, publicId: result.public_id }
    });

  } catch (error) {
    console.error('Upload Pipeline Error:', error);
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    res.status(500).json({ success: false, message: 'Upload pipeline failed' });
  }
};

/**
 * @route   DELETE /api/upload/:publicId
 * @desc    Delete file from Cloudinary
 * @access  Private
 */
export const deleteFile = async (req, res) => {
  try {
    const { publicId } = req.params;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Public ID is required'
      });
    }

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
