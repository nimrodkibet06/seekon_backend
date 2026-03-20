import { uploadToCloudinary } from '../config/cloudinary.js';
import fs from 'fs';
import path from 'path';
import { createJob, getJobStatus } from '../queue/jobQueue.js';

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

    // Validate files array
    if (!files || files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No valid files found.' 
      });
    }

    console.log(`🚀 Processing ${files.length} image(s) via async queue...`);

    const uploadedImages = [];

    // Process each file - upload to Cloudinary immediately, then queue for AI
    for (const file of files) {
      const localFilePath = file.path;

      try {
        console.log(`📤 Uploading original: ${file.originalname}`);
        
        // Upload raw image to Cloudinary first (fast, low memory)
        const result = await uploadToCloudinary(localFilePath, 'seekon-apparel');
        
        const cloudinaryUrl = result.url;
        const originalPublicId = result.public_id;
        
        console.log(`✅ Original uploaded: ${cloudinaryUrl}`);
        
        // Queue background removal job
        const jobId = createJob({
          cloudinaryUrl,
          originalPublicId,
          originalName: file.originalname
        });
        
        console.log(`📋 Job queued: ${jobId}`);
        
        uploadedImages.push({
          jobId,
          originalUrl: cloudinaryUrl,
          originalPublicId,
          status: 'pending'
        });

      } catch (itemError) {
        console.error(`❌ Failed to upload ${file.originalname}:`, itemError.message);
        // Continue with next file
      } finally {
        // Cleanup local temp file
        try {
          if (localFilePath && fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
          }
        } catch (cleanupError) {
          console.warn(`⚠️ Cleanup warning:`, cleanupError.message);
        }
      }
    }

    if (uploadedImages.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload any images'
      });
    }

    console.log(`\n🎉 Queued ${uploadedImages.length} images for background processing!`);

    return res.status(200).json({
      success: true,
      message: 'Images uploaded. Background removal in progress.',
      data: uploadedImages
    });

  } catch (error) {
    console.error('🚨 Server Upload Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Upload failed' 
    });
  }
};

/**
 * Get job status for background processing
 */
export const getUploadStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: 'Job ID required'
      });
    }
    
    const jobStatus = getJobStatus(jobId);
    
    if (!jobStatus) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: jobStatus
    });
    
  } catch (error) {
    console.error('🚨 Status Check Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get status'
    });
  }
};

// Keep deleteFile for backwards compatibility
export const deleteFile = async (req, res) => {
  try {
    const { publicId } = req.params;
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Public ID is required'
      });
    }
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
