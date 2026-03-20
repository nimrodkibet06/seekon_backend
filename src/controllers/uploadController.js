import removeBackground from '@imgly/background-removal-node';
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
        // Handle object with multiple field names
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

    // Validate files array
    if (!files || files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No valid files found.' 
      });
    }

    const uploadedImages = [];
    // Configure local AI to use the small model to protect Railway RAM
    const aiConfig = { 
      model: 'small', 
      output: { format: 'image/png' } 
    };

    console.log(`🚀 Starting sequential LOCAL AI processing of ${files.length} image(s)...`);

    // 2. THE QUEUE: Process sequentially using for...of to protect RAM
    for (const file of files) {
      const localFilePath = file.path;
      let processedFilePath = null;

      try {
        console.log(`\n📝 Processing: ${file.originalname}`);

        // 3. Local AI Integration - Read file into Blob
        const imageBuffer = fs.readFileSync(localFilePath);
        const imageBlob = new Blob([imageBuffer], { type: file.mimetype });

        // Run local background removal with small model
        const resultBlob = await removeBackground(imageBlob, aiConfig);

        // Save the transparent image to temp file
        const arrayBuffer = await resultBlob.arrayBuffer();
        processedFilePath = path.join(
          path.dirname(localFilePath), 
          `no-bg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
        );
        fs.writeFileSync(processedFilePath, Buffer.from(arrayBuffer));

        console.log(`✅ AI complete. Uploading to Cloudinary...`);

        // 4. Cloudinary Upload
        const result = await uploadToCloudinary(processedFilePath, 'seekon-apparel');

        uploadedImages.push({ 
          url: result.url, 
          publicId: result.public_id 
        });

        console.log(`✅ Uploaded: ${result.url}`);

      } catch (itemError) {
        // 4. FALLBACK: Upload original image if AI fails
        console.error(`⚠️ AI failed for ${file.originalname}:`, itemError.message);
        console.log(`🔄 Falling back to original image...`);
        
        try {
          const fallbackResult = await uploadToCloudinary(localFilePath, 'seekon-apparel');
          uploadedImages.push({ 
            url: fallbackResult.url, 
            publicId: fallbackResult.public_id 
          });
          console.log(`✅ Fallback uploaded: ${fallbackResult.url}`);
        } catch (fallbackError) {
          console.error(`❌ Fallback also failed:`, fallbackError.message);
          // Continue to next image instead of breaking
        }
      } finally {
        // 5. AGGRESSIVE CLEANUP: Delete temp files to prevent disk space leaks
        try {
          if (localFilePath && fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
          }
          if (processedFilePath && fs.existsSync(processedFilePath)) {
            fs.unlinkSync(processedFilePath);
          }
        } catch (cleanupError) {
          console.warn(`⚠️ Cleanup warning:`, cleanupError.message);
        }
      }
    }

    console.log(`\n🎉 Processed ${uploadedImages.length}/${files.length} images successfully!`);

    // 6. Return response
    return res.status(200).json({
      success: true,
      message: 'Images processed and uploaded',
      data: uploadedImages
    });

  } catch (error) {
    console.error('🚨 Server Upload Pipeline Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Upload pipeline failed' 
    });
  }
};

// Export deleteFile for backwards compatibility with routes
export const deleteFile = async (req, res) => {
  try {
    const { publicId } = req.params;
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Public ID is required'
      });
    }
    // Import dynamically to avoid circular dependencies
    const { deleteFromCloudinary } = await import('../config/cloudinary.js');
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
