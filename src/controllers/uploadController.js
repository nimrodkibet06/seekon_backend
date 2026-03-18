import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import fs from 'fs';

export const uploadFile = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const localFilePath = req.file.path;

  try {
    console.log('1. Sending image to Hugging Face API...');
    const imageBuffer = fs.readFileSync(localFilePath);
    
    // Call the free Hugging Face model
    const response = await fetch(
      "https://api-inference.huggingface.co/models/briaai/RMBG-1.4",
      {
        headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` },
        method: "POST",
        body: imageBuffer,
      }
    );

    let finalFilePath = localFilePath; // Default to original if AI fails

    if (response.ok) {
      console.log('2. Hugging Face Success! Saving transparent image locally...');
      const transparentBuffer = await response.arrayBuffer();
      finalFilePath = `${localFilePath}-nobg.png`;
      fs.writeFileSync(finalFilePath, Buffer.from(transparentBuffer));
    } else {
      console.log('⚠️ Hugging Face API failed or timed out. Falling back to original image.');
    }

    console.log('3. Uploading final image to Cloudinary...');
    const result = await uploadToCloudinary(finalFilePath, 'seekon-apparel');

    // 4. Aggressive Cleanup to save disk space
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    if (finalFilePath !== localFilePath && fs.existsSync(finalFilePath)) {
        fs.unlinkSync(finalFilePath);
    }

    // 5. Send the exact URL back to the frontend
    res.status(200).json({
      success: true,
      message: response.ok ? 'Image processed and uploaded' : 'Uploaded original image (AI unavailable)',
      data: {
        url: result.url,
        publicId: result.public_id
      }
    });

  } catch (error) {
    console.error('Upload Pipeline Error:', error);
    // Ensure temp files are deleted even on crash
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
