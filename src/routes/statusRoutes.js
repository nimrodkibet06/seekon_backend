import express from 'express';
import sharp from 'sharp';
import FlashStatus from '../models/FlashStatus.js';
import cloudinary from '../config/cloudinary.js';

const router = express.Router();

// @route   GET /api/status
// @desc    Get all active status updates (not older than 24 hours)
// @access  Public
router.get('/', async (req, res) => {
  try {
    const expirationTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Fetch statuses younger than 24h, sorted newest first
    const statuses = await FlashStatus.find({
      createdAt: { $gt: expirationTime }
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: statuses.length,
      data: statuses
    });
  } catch (error) {
    console.error('🔥 Error fetching active statuses:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active statuses.'
    });
  }
});

// @route   POST /api/status/verify-health
// @desc    Self-contained health check that simulates status ingestion, optimization, and lifecycle deletion
// @access  Public
router.post('/verify-health', async (req, res) => {
  const log = [];
  let testPublicId = null;

  try {
    log.push('1. Starting status pipeline health check...');

    // 1. Buffer Ingestion (Create a tiny 1x1 transparent GIF buffer)
    const mockGifBase64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const originalBuffer = Buffer.from(mockGifBase64, 'base64');
    log.push(`2. Ingested mock buffer: ${originalBuffer.length} bytes.`);

    // 2. Mock Optimization (Sharp Pipeline)
    log.push('3. Running Sharp optimization pipeline...');
    const optimizedBuffer = await sharp(originalBuffer)
      .resize({ width: 10, withoutEnlargement: true }) // small for testing
      .webp({ quality: 20 })
      .toBuffer();
    log.push(`4. Sharp optimized buffer size: ${optimizedBuffer.length} bytes.`);

    // 3. Cloudinary Upload simulation (we do a real upload to a test folder)
    log.push('5. Uploading test asset to Cloudinary...');
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'seekon-status-test',
          resource_type: 'image',
          format: 'webp'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(optimizedBuffer);
    });

    testPublicId = uploadResult.public_id;
    log.push(`6. Cloudinary upload successful. Public ID: ${testPublicId}, URL: ${uploadResult.secure_url}`);

    // 4. Mock Lifecycle Deletion
    log.push(`7. Triggering mock lifecycle deletion on Cloudinary for Public ID: ${testPublicId}...`);
    const destroyResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(testPublicId, { resource_type: 'image' }, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    log.push(`8. Cloudinary destruction response: ${JSON.stringify(destroyResult)}`);
    
    if (destroyResult.result === 'ok') {
      log.push('9. Cloudinary asset deleted successfully. Pipeline integrity VERIFIED.');
    } else {
      throw new Error(`Cloudinary returned unexpected response: ${destroyResult.result}`);
    }

    return res.status(200).json({
      success: true,
      message: 'Status CMS Engine pipeline health check PASSED.',
      log
    });

  } catch (error) {
    console.error('🔥 Health Check Pipeline Failure:', error);
    log.push(`❌ Pipeline Failure: ${error.message}`);
    
    // Attempt cleanup if upload succeeded but subsequent steps failed
    if (testPublicId) {
      try {
        await new Promise((resolve) => {
          cloudinary.uploader.destroy(testPublicId, { resource_type: 'image' }, () => resolve());
        });
        log.push('🧹 Post-failure cleanup of test asset completed.');
      } catch (cleanupError) {
        log.push(`⚠️ Failed to cleanup test asset: ${cleanupError.message}`);
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Status CMS Engine pipeline health check FAILED.',
      log
    });
  }
});

export default router;
