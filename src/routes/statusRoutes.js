import express from 'express';
import sharp from 'sharp';
import FlashStatus from '../models/FlashStatus.js';
import cloudinary from '../config/cloudinary.js';
import { sendSafeMessage, getRawClient, getStatus } from '../config/whatsapp.js';
import https from 'https';

const router = express.Router();

// Helper — download a URL and return base64 + mime type
const fetchMediaAsBase64 = (url) =>
  new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          data: buffer.toString('base64'),
          mimetype: res.headers['content-type'] || 'image/jpeg',
        });
      });
      res.on('error', reject);
    }).on('error', reject);
  });

// @route   GET /api/status
// @desc    Get all active status updates (not older than 24 hours)
// @access  Public
router.get('/', async (req, res) => {
  try {
    const expirationTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
    return res.status(500).json({ success: false, message: 'Failed to fetch active statuses.' });
  }
});

// @route   POST /api/status/buy   ← MUST come before /:id so it isn't swallowed
// @desc    Customer enters their phone number; bot sends the status image + details
//          to the admin WhatsApp — customer stays on the page.
// @body    { statusId: string, customerPhone: string }
// @access  Public
router.post('/buy', async (req, res) => {
  try {
    const { statusId, customerPhone } = req.body;

    if (!statusId || !customerPhone) {
      return res.status(400).json({ success: false, message: 'statusId and customerPhone are required.' });
    }

    // Normalize phone (Kenyan format 07xx → 2547xx)
    let cleanPhone = String(customerPhone).replace(/\D/g, '');
    if (cleanPhone.startsWith('0') && cleanPhone.length === 10) cleanPhone = '254' + cleanPhone.slice(1);
    if (cleanPhone.length < 9) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number. Use format 07XXXXXXXX or 2547XXXXXXXX.'
      });
    }

    // Check WA bot is online
    const waStatus = getStatus();
    if (!waStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Our WhatsApp bot is temporarily offline. Please try again shortly.'
      });
    }

    // Fetch the status document
    const status = await FlashStatus.findById(statusId);
    if (!status) {
      return res.status(404).json({ success: false, message: 'Status not found.' });
    }

    const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER || '254727672772';
    const siteUrl = process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com';

    // Build the admin alert message
    const textMessage =
      `🛍️ *NEW BUY REQUEST — Flash Status*\n\n` +
      `📌 *Status ID:* ${status._id}\n` +
      `📞 *Customer WA:* +${cleanPhone}\n` +
      `🕐 *Posted:* ${new Date(status.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}\n` +
      (status.caption ? `💬 *Caption:* ${status.caption}\n` : '') +
      `🔗 ${siteUrl}/status\n\n` +
      `Reply to customer: wa.me/${cleanPhone}`;

    // Send text to admin
    await sendSafeMessage(null, adminPhone, textMessage);

    // Attach image if it's an image type (videos too large for inline WA send)
    if (status.mediaType === 'image') {
      try {
        const { data: base64Data, mimetype } = await fetchMediaAsBase64(status.mediaUrl);
        const sock = getRawClient();
        if (sock) {
          // Baileys native image send — no MessageMedia class needed
          await sock.sendMessage(`${adminPhone}@s.whatsapp.net`, {
            image:   Buffer.from(base64Data, 'base64'),
            mimetype,
            caption: `📸 Item image — Ref: ${status._id}`,
          });
        }
      } catch (imgErr) {
        console.warn('⚠️ Could not attach status image:', imgErr.message);
        // Non-fatal — text was already delivered
      }
    }

    console.log(`✅ [STATUS BUY]: Admin notified. Status=${statusId} | Customer=+${cleanPhone}`);
    return res.status(200).json({
      success: true,
      message: "Your request has been sent! Our team will reach out to you on WhatsApp shortly. 🎉"
    });

  } catch (error) {
    console.error('🔥 [STATUS BUY] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send your request. Please try again.' });
  }
});

// @route   GET /api/status/:id
// @desc    Get a single status by MongoDB _id (used for tracking deep-links)
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const status = await FlashStatus.findById(req.params.id);
    if (!status) {
      return res.status(404).json({ success: false, message: 'Status not found.' });
    }
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    console.error('🔥 Error fetching status by ID:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch status.' });
  }
});

// @route   POST /api/status/verify-health
router.post('/verify-health', async (req, res) => {
  const log = [];
  let testPublicId = null;

  try {
    log.push('1. Starting status pipeline health check...');

    const mockGifBase64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const originalBuffer = Buffer.from(mockGifBase64, 'base64');
    log.push(`2. Ingested mock buffer: ${originalBuffer.length} bytes.`);

    log.push('3. Running Sharp optimization pipeline...');
    const optimizedBuffer = await sharp(originalBuffer)
      .resize({ width: 10, withoutEnlargement: true })
      .webp({ quality: 20 })
      .toBuffer();
    log.push(`4. Sharp optimized buffer size: ${optimizedBuffer.length} bytes.`);

    log.push('5. Uploading test asset to Cloudinary...');
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'seekon-status-test', resource_type: 'image', format: 'webp' },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      uploadStream.end(optimizedBuffer);
    });

    testPublicId = uploadResult.public_id;
    log.push(`6. Cloudinary upload successful. Public ID: ${testPublicId}`);

    log.push(`7. Deleting test asset from Cloudinary...`);
    const destroyResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(testPublicId, { resource_type: 'image' }, (error, result) => {
        if (error) reject(error); else resolve(result);
      });
    });

    log.push(`8. Cloudinary response: ${JSON.stringify(destroyResult)}`);
    if (destroyResult.result === 'ok') {
      log.push('9. Pipeline integrity VERIFIED.');
    } else {
      throw new Error(`Cloudinary unexpected response: ${destroyResult.result}`);
    }

    return res.status(200).json({ success: true, message: 'Status CMS Engine pipeline health check PASSED.', log });

  } catch (error) {
    console.error('🔥 Health Check Pipeline Failure:', error);
    log.push(`❌ Pipeline Failure: ${error.message}`);

    if (testPublicId) {
      try {
        await new Promise((resolve) => {
          cloudinary.uploader.destroy(testPublicId, { resource_type: 'image' }, () => resolve());
        });
        log.push('🧹 Post-failure cleanup completed.');
      } catch (cleanupError) {
        log.push(`⚠️ Failed to cleanup: ${cleanupError.message}`);
      }
    }

    return res.status(500).json({ success: false, message: 'Status CMS Engine pipeline health check FAILED.', log });
  }
});

export default router;
