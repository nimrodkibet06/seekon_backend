import { removeBackground } from '@imgly/background-removal-node';
import { uploadToCloudinary } from '../config/cloudinary.js';
import fs from 'fs';
import path from 'path';

export const uploadFile = async (req, res) => {
  try {
    // 1. THE CATCH-ALL: Safely extract files regardless of how Multer packaged them
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

    // 2. VALIDATION
    if (!files || files.length === 0) {
      console.error("Upload Error: Multer parsed request, but found no valid files.");
      return res.status(400).json({ success: false, message: 'No valid files found.' });
    }

    const uploadedImages = [];
    // Configure local AI to use the small model to protect Railway RAM
    const aiConfig = { model: 'small', output: { format: 'image/png' } };

    console.log(`🚀 Starting sequential LOCAL AI processing of ${files.length} image(s)...`);

    // 3. THE QUEUE: Process sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const localFilePath = file.path;
      let processedFilePath = null;

      try {
        console.log(`\n[${i + 1}/${files.length}] Local AI Processing: ${file.originalname}`);

        // Read file and convert to Blob for Imgly
        const imageBuffer = fs.readFileSync(localFilePath);
        const imageBlob = new Blob([imageBuffer], { type: file.mimetype });
        
        // Run local background removal
        const resultBlob = await removeBackground(imageBlob, aiConfig);
        
        // Save the transparent image locally
        const arrayBuffer = await resultBlob.arrayBuffer();
        processedFilePath = path.join(path.dirname(localFilePath), `no-bg-${Date.now()}-${i}.png`);
        fs.writeFileSync(processedFilePath, Buffer.from(arrayBuffer));

        console.log(`[${i + 1}/${files.length}] AI complete. Uploading to Cloudinary...`);
        const result = await uploadToCloudinary(processedFilePath, 'seekon-apparel');

        uploadedImages.push({ url: result.url, publicId: result.public_id });
        console.log(`[${i + 1}/${files.length}] ✅ Success!`);

      } catch (itemError) {
        console.error(`[${i + 1}/${files.length}] ⚠️ AI Failed. Falling back to original image. Error:`, itemError.message);
        
        // FALLBACK: Upload original image to Cloudinary so data is never lost
        const fallbackResult = await uploadToCloudinary(localFilePath, 'seekon-apparel');
        uploadedImages.push({ url: fallbackResult.url, publicId: fallbackResult.public_id });
      } finally {
        // AGGRESSIVE CLEANUP: Delete temp files to prevent disk space leaks
        if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
        if (processedFilePath && fs.existsSync(processedFilePath)) fs.unlinkSync(processedFilePath);
      }
    }

    console.log('\n🎉 All images processed and uploaded successfully!');
    return res.status(200).json({
      success: true,
      message: 'Images processed and uploaded',
      data: uploadedImages.length === 1 ? uploadedImages[0] : uploadedImages 
    });

  } catch (error) {
    console.error('🚨 Server Upload Pipeline Error:', error);
    return res.status(500).json({ success: false, message: 'Upload pipeline failed' });
  }
};
