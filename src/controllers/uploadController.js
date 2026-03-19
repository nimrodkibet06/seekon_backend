import { removeBackground } from '@imgly/background-removal-node';
import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import fs from 'fs';
import path from 'path';

export const uploadFile = async (req, res) => {
  try { // Top-level try block

    // 1. Safely extract files regardless of Multer configuration
    let files = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        files = req.files;
      } else {
        files = [
          ...(req.files.image || []), 
          ...(req.files.images || []),
          ...(req.files.file || []), 
          ...(req.files.files || [])
        ];
      }
    } else if (req.file) {
      files = [req.file];
    }

    // 2. Validate files exist
    if (!files || files.length === 0) {
      console.error("Upload Error: Multer parsed request, but found no valid files.");
      return res.status(400).json({ success: false, message: 'No valid files found.' });
    }

    const uploadedImages = [];
    const aiConfig = { model: 'small', output: { format: 'image/png' } };

    console.log(`Starting sequential AI processing of ${files.length} image(s)...`);

    // 3. Sequential Processing Loop
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const localFilePath = file.path;
      let processedFilePath = null;

      try { // Inner try block per file
        console.log(`\n[${i + 1}/${files.length}] AI Processing: ${file.originalname}`);

        const imageBuffer = fs.readFileSync(localFilePath);
        const imageBlob = new Blob([imageBuffer], { type: file.mimetype });
        
        const resultBlob = await removeBackground(imageBlob, aiConfig);
        
        const arrayBuffer = await resultBlob.arrayBuffer();
        processedFilePath = path.join(path.dirname(localFilePath), `no-bg-${Date.now()}-${i}.png`);
        fs.writeFileSync(processedFilePath, Buffer.from(arrayBuffer));

        console.log(`[${i + 1}/${files.length}] AI complete. Uploading to Cloudinary...`);
        const result = await uploadToCloudinary(processedFilePath, 'seekon-apparel');

        uploadedImages.push({ url: result.url, publicId: result.public_id });
        console.log(`[${i + 1}/${files.length}] Success!`);

      } catch (itemError) {
        console.error(`[${i + 1}/${files.length}] AI Failed on image. Falling back to original. Error:`, itemError.message);
        const fallbackResult = await uploadToCloudinary(localFilePath, 'seekon-apparel');
        uploadedImages.push({ url: fallbackResult.url, publicId: fallbackResult.public_id });
      } finally {
        // Cleanup temporary files
        if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
        if (processedFilePath && fs.existsSync(processedFilePath)) fs.unlinkSync(processedFilePath);
      }
    }

    console.log('\n✅ All images processed successfully!');
    return res.status(200).json({
      success: true,
      message: 'Images processed and uploaded',
      data: uploadedImages.length === 1 ? uploadedImages[0] : uploadedImages 
    });

  } catch (error) { // Top-level catch block
    console.error('Server Upload Pipeline Error:', error);
    return res.status(500).json({ success: false, message: 'Upload pipeline failed' });
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
