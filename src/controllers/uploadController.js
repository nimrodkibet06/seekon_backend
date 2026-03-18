import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import fs from 'fs';

// The Background Worker (Does not block the response)
const processBackgroundRemoval = async (localFilePath, originalPublicId) => {
  try {
    console.log('Background Job: Sending image to Hugging Face...');
    const imageBuffer = fs.readFileSync(localFilePath);
    
    // Using briaai/RMBG-1.4 (Excellent free background removal model)
    const response = await fetch(
      "https://api-inference.huggingface.co/models/briaai/RMBG-1.4",
      {
        headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` },
        method: "POST",
        body: imageBuffer,
      }
    );

    if (!response.ok) throw new Error('Hugging Face API failed');

    const transparentBuffer = await response.arrayBuffer();
    const tempBgRemovedPath = `${localFilePath}-nobg.png`;
    fs.writeFileSync(tempBgRemovedPath, Buffer.from(transparentBuffer));

    console.log('Background Job: Uploading transparent version to Cloudinary...');
    // We upload to Cloudinary. In a full implementation, you'd then update your MongoDB product document here!
    const result = await uploadToCloudinary(tempBgRemovedPath, 'seekon-apparel');
    console.log('Background Job: Success! New URL:', result.url);

    // Cleanup
    if (fs.existsSync(tempBgRemovedPath)) fs.unlinkSync(tempBgRemovedPath);
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);

  } catch (error) {
    console.error('Background Job Failed:', error.message);
    // If it fails, we still have the original image uploaded, so nothing is broken.
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
  }
};

/**
 * @route   POST /api/upload
 * @desc    Upload file to Cloudinary with background removal (Fire and Forget)
 * @access  Private
 */
export const uploadFile = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file' });

  const localFilePath = req.file.path;

  try {
    // 1. Instantly upload original image to Cloudinary (Fast)
    const originalUpload = await uploadToCloudinary(localFilePath, 'seekon-apparel');

    // 2. FIRE AND FORGET: Start the background job WITHOUT the 'await' keyword
    processBackgroundRemoval(localFilePath, originalUpload.public_id);

    // 3. INSTANT RESPONSE: Tell frontend it worked immediately
    res.status(200).json({
      success: true,
      message: 'Image uploaded. Background removal is processing in the background.',
      data: {
        url: originalUpload.url, // Temporary original URL
        publicId: originalUpload.public_id
      }
    });

  } catch (error) {
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    res.status(500).json({ success: false, message: 'Upload failed' });
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
