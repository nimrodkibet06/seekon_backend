// ============================================================
//  Seekon Apparel — WhatsApp Engine
//  Library : @whiskeysockets/baileys  (WebSocket, no Chromium)
//  Replaces: whatsapp-web.js + puppeteer
//  Purpose : OOM-safe connection, status scraping, outbound
//            order/payment notifications.
// ============================================================

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { v2 as cloudinaryV2 } from 'cloudinary';
import mongoose from 'mongoose';
import { Queue } from 'bullmq';

// Internal imports — same as before, no breaking changes to consumers
import {
  sendAdminOfflineAlertEmail,
  sendSuccessNotificationEmail,
  getResendClient,
} from '../utils/email.js';
import FlashStatus from '../models/FlashStatus.js';
import StatusTask  from '../models/StatusTask.js';
import Setting from '../models/Setting.js';
import { normalizePhone } from '../utils/phoneFormatter.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { getGroqClient } from '../utils/groqProvider.js';

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Isolated Cloudinary instance for status media (Account B)
//           Reads CLOUDINARY_STATUS_* env vars so it never touches the main
//           product-catalog Cloudinary account.
//           Falls back to the primary account if Status-specific vars are absent.
// ─────────────────────────────────────────────────────────────────────────────
const buildStatusCloudinary = () => {
  const cloud  = process.env.CLOUDINARY_STATUS_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME;
  const key    = process.env.CLOUDINARY_STATUS_API_KEY    || process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_STATUS_API_SECRET || process.env.CLOUDINARY_API_SECRET;

  if (!cloud || !key || !secret) {
    console.warn('⚠️ [WA]: Status Cloudinary credentials not configured — media upload will be skipped.');
    return null;
  }

  // Configure the shared v2 instance with Account B credentials.
  // We return a plain object wrapping a freshly-configured clone so the main
  // cloudinary instance (used for product images) is left completely untouched.
  const { v2: cl } = { v2: cloudinaryV2 };  // reference to the imported v2
  // Create an independent config scope by using the config() API with a new object
  const instance = cl;
  // NOTE: We intentionally scope Account B uploads by passing the config inline
  // to every upload_stream call, so we NEVER mutate the global config.
  return { cloud, key, secret };
};

const STATUS_CLOUDINARY_CREDS = buildStatusCloudinary();

/**
 * Run a Cloudinary upload_stream call using the Status Account B credentials,
 * without touching the global cloudinary config.
 */
const uploadToStatusCloudinary = (buffer, options) => {
  if (!STATUS_CLOUDINARY_CREDS) {
    return Promise.reject(new Error('Status Cloudinary not configured.'));
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinaryV2.uploader.upload_stream(
      {
        ...options,
        // Inline credentials override — keeps Account B isolated from Account A
        api_key:    STATUS_CLOUDINARY_CREDS.key,
        api_secret: STATUS_CLOUDINARY_CREDS.secret,
        cloud_name: STATUS_CLOUDINARY_CREDS.cloud,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Silent pino logger (suppresses all Baileys internal noise on server)
// ─────────────────────────────────────────────────────────────────────────────
const logger = pino({ level: 'silent' });

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state (mirrors the old whatsapp-web.js globals exactly)
// ─────────────────────────────────────────────────────────────────────────────
let sock           = null;    // active WASocket instance
let isConnected    = false;
let currentQR      = null;
let isShuttingDown = false;
let reconnectTimer = null;

// Lightweight message cache — replaces makeInMemoryStore (removed in Baileys v7)
// Maps "jid:messageId" → WAMessage for the getMessage hook only
const messageCache = new Map();
const MAX_CACHE_SIZE = 500;

const activeSessions = new Map();
const adminUploadSessions = new Map();
const sentMessageIds = new Set();
const rawGroupJid = process.env.ADMIN_GROUP_JID || process.env.ADMIN_WHATSAPP_GROUP_ID || '';
const adminGroupJid = rawGroupJid.replace(/['"]/g, '').trim();
const imageQueue = new Queue('imageQueue', { connection: { host: '127.0.0.1', port: 6379 } });

// Seekon Product Schema for WhatsApp Admin Panel writes
const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, required: true, trim: true },
    subCategory: { type: String, default: '' },
    brand: { type: String, required: true },
    sizes: [{ type: String }],
    colors: [{ type: String }],
    image: { type: String, default: '' },
    images: [{ type: String }],
    status: { type: String, enum: ['processing', 'active', 'inactive'], default: 'active' },
    stock: { type: Number, default: 0 },
    inStock: { type: Boolean, default: true }
}, { timestamps: true });
const Product = mongoose.models.Product || mongoose.model('Product', ProductSchema);
const cacheMessage = (msg) => {
  if (!msg?.key?.remoteJid || !msg?.key?.id) return;
  const cacheKey = `${msg.key.remoteJid}:${msg.key.id}`;
  messageCache.set(cacheKey, msg);
  if (messageCache.size > MAX_CACHE_SIZE) {
    // Evict oldest entry to cap memory footprint
    messageCache.delete(messageCache.keys().next().value);
  }
};

// Auth credentials directory — persisted between process restarts
const AUTH_DIR = process.env.WHATSAPP_SESSION_PATH || './baileys_auth_info';

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Pseudo-Gaussian jitter utility (anti-ban, human-like timing)
//           Central-limit theorem approximation: average of 6 uniform[0,1]
//           samples produces a bell-curve centred around the range midpoint.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns a promise that resolves after a pseudo-Gaussian jittered delay.
 * @param {number} minMs  Lower bound in milliseconds (default 1500)
 * @param {number} maxMs  Upper bound in milliseconds (default 5000)
 */
const humanDelay = (minMs = 1500, maxMs = 5000) => {
  const range = maxMs - minMs;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Math.random(); // CLT approximation
  const gaussian = sum / 6; // ∈ [0,1] bell-shaped
  const delay = Math.floor(minMs + gaussian * range);
  console.log(`⏳ [WA-JITTER]: Applying ${delay}ms human-like delay...`);
  return new Promise(resolve => setTimeout(resolve, delay));
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Typing simulation before any outbound text message
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Fires a 'composing' presence update and holds it for a duration proportional
 * to the message length, simulating a human typing the message.
 * @param {string} chatId    JID of the recipient chat
 * @param {string} message   Text content about to be sent
 */
const simulateTyping = async (chatId, message) => {
  if (!sock || !isConnected) return;
  try {
    const wpm = 200; // average human typing speed (words per minute)
    const words = (message || '').split(/\s+/).length;
    const typingMs = Math.min(Math.max((words / wpm) * 60000, 1500), 8000);

    await sock.sendPresenceUpdate('composing', chatId);
    console.log(`💬 [WA-TYPING]: Simulating typing for ${Math.round(typingMs)}ms (${words} words) → ${chatId}`);
    await new Promise(resolve => setTimeout(resolve, typingMs));
    await sock.sendPresenceUpdate('paused', chatId);
  } catch (e) {
    // Presence updates fail silently when the chat window is not open — expected
    console.warn('⚠️ [WA-TYPING]: Presence update failed (non-fatal):', e.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — MongoDB LID / Phone whitelist loader
//           Reads CACHED DB records — no real-time contact lookups on the stream
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @returns {{ authorizedPhones: string[], authorizedLids: string[] }}
 */
const loadAuthorizedIdentifiers = async () => {
  const rawPhones = [];
  const rawLids   = [];

  // Phone numbers from MongoDB Settings
  try {
    const phoneSetting = await Setting.findOne({ key: 'authorized_status_phones' });
    if (phoneSetting?.value?.phones && Array.isArray(phoneSetting.value.phones)) {
      phoneSetting.value.phones.forEach(num => {
        const clean = normalizePhone(num);
        if (clean) rawPhones.push(clean);
      });
    }
  } catch (e) {
    console.error('⚠️ [WA-AUTH]: DB phone fetch failed:', e.message);
  }

  // Env-var fallback phones
  if (process.env.AUTHORIZED_ADMIN_PHONES) {
    process.env.AUTHORIZED_ADMIN_PHONES.split(',')
      .forEach(n => {
        const clean = normalizePhone(n);
        if (clean) rawPhones.push(clean);
      });
  }

  // LIDs from MongoDB Settings (stored by the admin panel)
  try {
    const lidSetting = await Setting.findOne({ key: 'authorized_status_lids' });
    if (lidSetting?.value?.lids && Array.isArray(lidSetting.value.lids)) {
      lidSetting.value.lids.forEach(lid => {
        const clean = String(lid).trim();
        if (clean) rawLids.push(clean.includes('@lid') ? clean : `${clean}@lid`);
      });
    }
  } catch (e) { /* silent — LIDs are supplemental */ }

  return {
    authorizedPhones: [...new Set(rawPhones)],
    authorizedLids:   [...new Set(rawLids)],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Sender authorization check (LID hybrid model)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}   senderId  msg.key.participant || msg.key.remoteJid
 * @param {string[]} phones    Authorized phone numbers (digits only, e.g. "254712...")
 * @param {string[]} lids      Authorized LIDs (with @lid suffix)
 * @returns {boolean}
 */
const isSenderAuthorized = (senderId, phones, lids) => {
  if (!senderId) return false;

  // STEP 3.3 — WhatsApp Logical ID path: clean string match against DB records
  if (senderId.endsWith('@lid')) {
    const senderLidClean = senderId.replace('@lid', '');
    const match = lids.some(l =>
      l === senderId || l.replace('@lid', '') === senderLidClean
    );
    if (!match) {
      console.log(`❌ [WA-AUTH]: LID ${senderId} NOT in whitelist [${lids.join(', ')}]. Skipping.`);
    }
    return match;
  }

  // Standard JID path (e.g. 254712345678@s.whatsapp.net or @c.us)
  const rawNumber = senderId.replace(/@[^@]+$/, '');
  const match = phones.some(p =>
    p === rawNumber ||
    senderId === `${p}@c.us` ||
    senderId === `${p}@s.whatsapp.net`
  );
  if (!match) {
    console.log(`❌ [WA-AUTH]: JID ${senderId} NOT in whitelist. Skipping.`);
  }
  return match;
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Lead pipeline: First-Time Lead Captured email via Resend
// ─────────────────────────────────────────────────────────────────────────────
/**
 * If the interacting JID does not exist in our DB:
 *  1. Save it to MongoDB (de-dup guard)
 *  2. Send 'First-Time Lead Captured' email to store administrator via Resend
 * @param {string} viewerJid  e.g. "254712345678@s.whatsapp.net"
 */
const handleLeadCapture = async (viewerJid) => {
  try {
    if (!viewerJid) return;
    const phone = viewerJid.replace(/@[^@]+$/, '');

    // Check if this contact already exists as a registered user
    const existingUser = await User.findOne({
      $or: [
        { phone },
        { phone: `0${phone.slice(3)}` },
        { phone: `+${phone}` },
      ]
    }).lean();

    if (existingUser) return; // Already in the pipeline — no action needed

    // De-dup guard: have we already sent a lead alert for this number?
    const leadKey = `lead_captured_${phone}`;
    const alreadyLogged = await Setting.findOne({ key: leadKey }).lean();
    if (alreadyLogged) return;

    // Persist the lead flag to MongoDB BEFORE sending email (prevents duplicates)
    await Setting.findOneAndUpdate(
      { key: leadKey },
      { $set: { key: leadKey, value: { phone, capturedAt: new Date() } } },
      { upsert: true, new: true }
    );

    // Resolve admin emails
    let adminEmails = [];
    try {
      const admins = await Admin.find({}).select('email').lean();
      adminEmails = admins.map(a => a.email).filter(Boolean);
    } catch (e) {}
    if (!adminEmails.length) {
      const adminUsers = await User.find({ role: 'admin' }).select('email').lean();
      adminEmails = adminUsers.map(u => u.email).filter(Boolean);
    }
    if (!adminEmails.length && process.env.ADMIN_EMAIL) {
      adminEmails = [process.env.ADMIN_EMAIL];
    }

    const resend = getResendClient();
    if (!resend || !adminEmails.length) return;

    await resend.emails.send({
      from: 'Seekon Apparel Bot <no-reply@seekonapparelglobal.com>',
      to: adminEmails,
      subject: '🎯 First-Time Lead Captured via WhatsApp Status',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;
                    background:#f9f9f9;border-radius:8px;">
          <h2 style="color:#1a1a2e;">🎯 New Lead Captured</h2>
          <p>A potential customer interacted with your WhatsApp status but is
             <strong>not yet in the Seekon database</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <tr>
              <td style="padding:8px;font-weight:bold;">Phone / JID</td>
              <td style="padding:8px;">${viewerJid}</td>
            </tr>
            <tr>
              <td style="padding:8px;font-weight:bold;">Captured At</td>
              <td style="padding:8px;">${new Date().toUTCString()}</td>
            </tr>
          </table>
          <p style="margin-top:20px;color:#555;">
            Follow up to convert this lead into a Seekon Apparel customer.
          </p>
          <p style="color:#aaa;font-size:12px;">
            Seekon Apparel Automated Alert — Do not reply to this email.
          </p>
        </div>
      `,
    });

    console.log(`📧 [WA-LEAD]: First-Time Lead email sent for ${viewerJid}`);
  } catch (err) {
    // Non-fatal — lead capture must never crash the main status loop
    console.error('⚠️ [WA-LEAD]: Lead capture pipeline error (non-fatal):', err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Status media download + STEP 5 Cloudinary Account B upload pipeline
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Downloads raw binary buffer via Baileys (no browser) and pipes it into
 * the isolated Status Cloudinary account (Account B).
 * @param {object} msg      Full WAMessage object from messages.upsert
 * @returns {object|null}   { uploadResult, mediaType, mimeType } or null on failure
 */
const processStatusMedia = async (msg) => {
  const isImage = !!(msg.message?.imageMessage);
  const isVideo = !!(msg.message?.videoMessage);

  if (!isImage && !isVideo) {
    console.log('⚠️ [WA-STATUS]: Status has no image or video payload. Skipping media pipeline.');
    return null;
  }

  const mediaType = isImage ? 'image' : 'video';
  const mimeType  = isImage
    ? (msg.message.imageMessage.mimetype  || 'image/jpeg')
    : (msg.message.videoMessage.mimetype  || 'video/mp4');

  console.log(`📥 [WA-STATUS]: Downloading ${mediaType} buffer natively via Baileys...`);

  // STEP 4.2 — Baileys native downloadMediaMessage (no browser / Chromium state)
  let rawBuffer;
  try {
    rawBuffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger, reuploadRequest: sock?.updateMediaMessage }
    );
  } catch (dlErr) {
    // STEP 4.3 — Graceful boundary: decryption failures or expired media must not crash
    console.error(
      '❌ [WA-STATUS]: Media download failed (expired or decryption error, handled gracefully):',
      dlErr.message
    );
    return null;
  }

  if (!rawBuffer || rawBuffer.length === 0) {
    console.error('❌ [WA-STATUS]: Downloaded buffer is empty. Skipping.');
    return null;
  }

  console.log(`⚙️ [WA-STATUS]: ${mediaType} buffer ready (${rawBuffer.length} bytes). Uploading to Status Cloudinary (Account B)...`);

  if (!STATUS_CLOUDINARY_CREDS) {
    console.warn('⚠️ [WA-STATUS]: Status Cloudinary not configured — skipping upload.');
    return null;
  }

  let uploadResult;
  try {
    if (mediaType === 'image') {
      // Image sub-pipeline: auto-rotate, strip metadata, compress to WebP 1080px
      const processedBuffer = await sharp(rawBuffer)
        .rotate()
        .resize({ width: 1080, withoutEnlargement: true })
        .webp({ quality: 50 })
        .withMetadata(false)
        .toBuffer();

      console.log(`⚙️ [WA-STATUS]: Image optimised → ${processedBuffer.length} bytes. Uploading...`);

      uploadResult = await uploadToStatusCloudinary(processedBuffer, {
        folder:        'seekon-status',
        resource_type: 'image',
        fetch_format:  'webp',
        quality:       'auto',
      });

    } else {
      // Video sub-pipeline: eager 15s cap + MP4 output, non-blocking (eager_async)
      console.log('⚙️ [WA-STATUS]: Streaming video to Status Cloudinary with eager transforms...');

      uploadResult = await uploadToStatusCloudinary(rawBuffer, {
        folder:        'seekon-status',
        resource_type: 'video',
        eager: [{
          duration:     '15.0',
          width:        480,
          crop:         'limit',
          quality:      'auto',
          fetch_format: 'mp4',
        }],
        eager_async: true,
      });
    }
  } catch (uploadErr) {
    // STEP 4.3 — Upload failures must never propagate and crash the main loop
    console.error('❌ [WA-STATUS]: Cloudinary upload failed (gracefully handled):', uploadErr.message);
    return null;
  }

  if (!uploadResult?.secure_url) {
    console.error('❌ [WA-STATUS]: Cloudinary returned no URL.');
    return null;
  }

  console.log(`✅ [WA-STATUS]: Uploaded to Status Cloudinary (Account B): ${uploadResult.secure_url}`);
  return { uploadResult, mediaType, mimeType };
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Background worker: the entire heavy pipeline lives here.
//
// Called in two contexts:
//   A) Fire-and-forget from handleStatusUpsert (new live status)
//   B) Recovery from resumeDroppedTasks (PM2-killed pending tasks)
//
// @param {object} task   Mongoose StatusTask document
// @param {object} msg    Full WAMessage object (live) OR null (recovery path,
//                        where we re-download from the saved payload snapshot)
// ─────────────────────────────────────────────────────────────────────────────
const processStatusTaskBackground = async (task, msg) => {
  const label = `[WA-WORKER:${task.messageId.slice(-8)}]`;
  console.log(`⚙️ ${label} Background worker started (attempt ${task.attempts}).`);

  try {
    // ── Media acquisition ──────────────────────────────────────────────────
    // On the live path, msg is the real WAMessage from messages.upsert.
    // On the recovery path, msg is reconstructed from task.payload.msgSnapshot.
    const liveMsg = msg || task.payload.msgSnapshot;

    if (!liveMsg) {
      throw new Error('No message object available — cannot download media.');
    }

    // ── Download + Sharp + Cloudinary (unchanged pipeline) ─────────────────
    const mediaResult = await processStatusMedia(liveMsg);
    if (!mediaResult) {
      // No media (text-only status) or graceful failure — mark completed so
      // it doesn't get endlessly retried by the recovery loop.
      await StatusTask.findByIdAndUpdate(task._id, {
        status:     'completed',
        resolvedAt: new Date(),
      });
      console.log(`✅ ${label} No media payload — task marked completed (no-op).`);
      return;
    }

    const { uploadResult, mediaType } = mediaResult;
    const senderId = task.payload.authorJid;
    const caption  = task.payload.caption || '';

    // ── Persist to FlashStatus collection ──────────────────────────────────
    const flashStatus = new FlashStatus({
      mediaUrl:           uploadResult.secure_url,
      mediaType,
      caption,
      author:             senderId,
      cloudinaryPublicId: uploadResult.public_id,
      createdAt:          new Date(),
    });
    await flashStatus.save();
    console.log(`💾 ${label} FlashStatus saved: ID ${flashStatus._id}`);

    // ── Resend admin success email (non-blocking, non-fatal) ───────────────
    // sendSuccessNotificationEmail('nimrodkibet376@gmail.com', {
    //   author:    senderId,
    //   type:      mediaType,
    //   mediaUrl:  uploadResult.secure_url,
    //   timestamp: flashStatus.createdAt,
    // }).catch(e =>
    //   console.error(`⚠️ ${label} Success email failed (non-fatal):`, e.message)
    // );
    console.log(`ℹ️ ${label} Admin success email notification skipped per configuration.`);

    // ── Mark task completed ────────────────────────────────────────────────
    await StatusTask.findByIdAndUpdate(task._id, {
      status:     'completed',
      resolvedAt: new Date(),
    });
    console.log(`✅ ${label} Task marked COMPLETED.`);

  } catch (err) {
    // ── Mark task failed — will NOT be retried by recovery loop ───────────
    // Prevents a permanently broken message (e.g. expired media key) from
    // hammering the pipeline on every reconnect.
    console.error(`❌ ${label} Background worker error:`, err.message);
    try {
      await StatusTask.findByIdAndUpdate(task._id, {
        status:        'failed',
        failureReason: err.message,
        resolvedAt:    new Date(),
      });
    } catch (dbErr) {
      console.error(`❌ ${label} Could not update task to failed:`, dbErr.message);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Startup recovery: re-fire any tasks stuck in 'pending'.
//
// Called strictly when connection === 'open' to ensure the socket is live
// and downloadMediaMessage() will succeed.
// Non-blocking: uses Promise.allSettled so one failed recovery doesn't
// block the others.
// ─────────────────────────────────────────────────────────────────────────────
const resumeDroppedTasks = async () => {
  try {
    const stuck = await StatusTask.find({ status: 'pending' }).lean();

    if (!stuck.length) {
      console.log('🔍 [WA-RECOVERY]: No stuck tasks found.');
      return;
    }

    console.log(`🔄 [WA-RECOVERY]: Found ${stuck.length} stuck pending task(s). Re-firing...`);

    // Increment attempt counter on all recovered tasks before re-running
    await StatusTask.updateMany(
      { _id: { $in: stuck.map(t => t._id) } },
      { $inc: { attempts: 1 } }
    );

    // Re-fire each task concurrently; allSettled ensures none block the others
    const results = await Promise.allSettled(
      stuck.map(task => processStatusTaskBackground(task, null))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed    = results.filter(r => r.status === 'rejected').length;
    console.log(`🔄 [WA-RECOVERY]: Recovery complete — ✅ ${succeeded} succeeded, ❌ ${failed} failed.`);

  } catch (err) {
    // Recovery must never crash the main connection handler
    console.error('⚠️ [WA-RECOVERY]: Recovery scan failed (non-fatal):', err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 + 5 — handleStatusUpsert: core messages.upsert handler
// ─────────────────────────────────────────────────────────────────────────────
const recentlyProcessed = new Set();

const handleStatusUpsert = async (messages) => {
  for (const msg of messages) {
    try {
      // Gate 1 — Hard filter: only process status@broadcast messages.
      // Any other remoteJid (DMs, groups) is handled by its own dedicated listener.
      if (msg.key?.remoteJid !== 'status@broadcast') continue;

      // Sender resolution: status participants use the participant field
      const senderId = msg.key?.participant || msg.key?.remoteJid;

      // Dedup fingerprint — prevents double-processing the same status event
      const msgKey = `${senderId}_${msg.messageTimestamp || Date.now()}`;
      if (recentlyProcessed.has(msgKey)) continue;
      recentlyProcessed.add(msgKey);
      setTimeout(() => recentlyProcessed.delete(msgKey), 15000);

      console.log(`📱 [WA-STATUS]: Incoming status broadcast from ${senderId}`);

      // Authorization check
      const { authorizedPhones, authorizedLids } = await loadAuthorizedIdentifiers();
      console.log(`📱 [WA-STATUS]: Whitelist → phones: [${authorizedPhones.join(', ')}] | LIDs: [${authorizedLids.join(', ')}]`);

      if (!isSenderAuthorized(senderId, authorizedPhones, authorizedLids)) {
        console.log(`⏭️ [WA-STATUS]: ${senderId} not in whitelist — skipping. No email triggered.`);
        continue;
      }

      console.log(`✅ [WA-STATUS]: ${senderId} authorized. Queuing background task...`);

      // Escape hatch: caption containing '.' signals an intentional skip
      const caption =
        msg.message?.imageMessage?.caption  ||
        msg.message?.videoMessage?.caption  ||
        msg.message?.extendedTextMessage?.text || '';

      if (caption.includes('.')) {
        console.log('🤫 [WA-STATUS]: Escape hatch triggered (caption contains "."). Skipping.');
        continue;
      }

      // ── STEP 2 — Write a 'pending' task record BEFORE firing any async work.
      // If PM2 kills the process mid-upload, this record survives in MongoDB
      // and resumeDroppedTasks() will re-fire it on the next reconnect.
      //
      // msgSnapshot stores the message structure (not the media buffer — that
      // is re-downloaded from WhatsApp during recovery).
      let task;
      try {
        task = await StatusTask.create({
          messageId:  msgKey,
          authorJid:  senderId,
          status:     'pending',
          payload: {
            authorJid:   senderId,
            caption,
            msgSnapshot: {
              key:              msg.key,
              messageTimestamp: msg.messageTimestamp,
              message:          msg.message,
            },
          },
        });
        console.log(`📝 [WA-STATUS]: Task created (pending): ${task._id}`);
      } catch (dupErr) {
        // unique index on messageId: duplicate means already queued — skip safely
        if (dupErr.code === 11000) {
          console.log(`⏭️ [WA-STATUS]: Duplicate task for ${msgKey} — already queued. Skipping.`);
          continue;
        }
        throw dupErr; // unexpected DB error — let the outer catch handle it
      }

      // ── STEP 2 — Anti-ban jitter delay (lightweight, still awaited here
      // so the event loop isn't flooded before we hand off to background)
      await humanDelay(1500, 5000);

      // ── STEP 2 — FIRE AND FORGET: hand off to background worker.
      // No 'await' — the event listener returns immediately and the socket
      // remains fully responsive while the upload runs in the background.
      processStatusTaskBackground(task, msg).catch(err =>
        console.error(`🔥 [WA-STATUS]: Unhandled background worker error for task ${task._id}:`, err.message)
      );

      console.log(`🚀 [WA-STATUS]: Task ${task._id} handed off to background worker. Event loop free.`);

    } catch (err) {
      // Top-level boundary: a single status failure must never crash the process
      console.error('🔥 [WA-STATUS INTERCEPT ERROR]:', err.message || err);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Lead capture — fires ONLY on authentic incoming direct messages.
// Completely isolated from status@broadcast processing.
// Triggered when a real customer DMs the store WhatsApp number directly.
// ─────────────────────────────────────────────────────────────────────────────
const handleDirectMessageUpsert = async (messages) => {
  for (const msg of messages) {
    try {
      const remoteJid = msg.key?.remoteJid || '';

      // Gate: only real 1-to-1 DMs (remoteJid ends with @s.whatsapp.net).
      // Groups (@g.us), status broadcasts (status@broadcast),
      // and system JIDs are all explicitly excluded.
      if (!remoteJid.endsWith('@s.whatsapp.net')) continue;

      // Ignore messages sent by the bot itself
      if (msg.key?.fromMe) continue;

      // Skip if the sender is an authorized admin or has an active admin session
      const senderId = msg.key?.participant || msg.key?.remoteJid || '';
      const { authorizedPhones, authorizedLids } = await loadAuthorizedIdentifiers();
      if (isSenderAuthorized(senderId, authorizedPhones, authorizedLids) || adminUploadSessions.has(senderId)) {
        continue;
      }

      console.log(`📩 [WA-DM]: Incoming direct message from ${remoteJid}`);

      // Fire the lead capture pipeline for this genuine customer contact
      await handleLeadCapture(remoteJid);

    } catch (err) {
      // Non-fatal — DM lead capture must never crash anything
      console.error('⚠️ [WA-DM]: Direct message lead handler error (non-fatal):', err.message);
    }
  }
};

/**
 * getExistingBrands — Dynamically queries the database for all registered brand names (uppercased).
 * Ensures that AI-suggested brands match existing ones precisely, falling back to 'SEEKON'.
 */
const getExistingBrands = async () => {
  try {
    const Brand = mongoose.models.Brand || mongoose.model('Brand');
    const brandDocs = await Brand.find({ isActive: true }, 'name');
    const brandNames = brandDocs.map(b => b.name.trim().toUpperCase());
    
    const distinctProductBrands = await Product.distinct('brand');
    for (const b of distinctProductBrands) {
      if (b) {
        const upperB = b.trim().toUpperCase();
        if (!brandNames.includes(upperB)) {
          brandNames.push(upperB);
        }
      }
    }
    
    if (!brandNames.includes('SEEKON')) {
      brandNames.push('SEEKON');
    }
    return brandNames;
  } catch (err) {
    console.error('Error fetching existing brands:', err);
    return ['SEEKON', 'NIKE', 'ADIDAS', 'PUMA', 'JORDAN', 'NEW BALANCE'];
  }
};

/**
 * analyzeProductWithAI — Calls Groq (llama-3.3-70b-versatile) to deduce brand,
 * category (Sneakers, Apparel, Accessories), and write a persuasive product description in JSON mode.
 */
const analyzeProductWithAI = async (productName, existingBrands) => {
  try {
    const groq = getGroqClient();
    
    const systemPrompt = `You are a product catalog manager for Seekon.
Analyze the following product name: "${productName}"
Determine:
1. Brand: Deduces the brand of the product (e.g., Nike, Jordan, Adidas, Seekon, etc.).
2. Category: Deduces whether the product belongs to: "Sneakers", "Apparel", or "Accessories".
3. Description: Generate a modern, persuasive, and concise single-paragraph product description (maximum 3-4 high-impact sentences). Do not use markdown, do not use asterisks, do not include introductory phrases.

You must reply with a valid JSON object ONLY. The JSON keys must be:
- "brand": string (e.g. "Nike")
- "category": string (must be exactly "Sneakers", "Apparel", or "Accessories")
- "description": string (the generated description)

Do NOT wrap the response in markdown blocks like \`\`\`json. Output raw JSON string only.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: productName }
      ],
      response_format: { type: "json_object" }
    });

    const resultText = response.choices[0]?.message?.content || "{}";
    
    let data = {};
    try {
      data = JSON.parse(resultText);
    } catch (parseErr) {
      console.warn('Failed to parse Groq JSON response, attempting regex fallback:', parseErr);
      const brandMatch = resultText.match(/"brand"\s*:\s*"([^"]+)"/);
      const catMatch = resultText.match(/"category"\s*:\s*"([^"]+)"/);
      const descMatch = resultText.match(/"description"\s*:\s*"([^"]+)"/);
      data = {
        brand: brandMatch ? brandMatch[1] : 'Seekon',
        category: catMatch ? catMatch[1] : 'Sneakers',
        description: descMatch ? descMatch[1] : `High-quality ${productName} from Seekon.`
      };
    }
    
    // Match brand against existing database brands (case-insensitive)
    let finalBrand = 'SEEKON';
    if (data.brand && typeof data.brand === 'string') {
      const match = existingBrands.find(b => b.toUpperCase() === data.brand.trim().toUpperCase());
      if (match) {
        finalBrand = match;
      }
    }
    
    // Category mapping: Sneakers, Apparel, Accessories
    let finalCategory = 'Sneakers'; // default fallback
    if (data.category && typeof data.category === 'string') {
      const catUpper = data.category.trim().toUpperCase();
      if (catUpper.includes('SNEAKER') || catUpper.includes('SHOE')) {
        finalCategory = 'Sneakers';
      } else if (catUpper.includes('APPAREL') || catUpper.includes('CLOTH') || catUpper.includes('WEAR') || catUpper.includes('JACKET') || catUpper.includes('HOODIE') || catUpper.includes('SHIRT') || catUpper.includes('PANT')) {
        finalCategory = 'Apparel';
      } else if (catUpper.includes('ACCESSOR') || catUpper.includes('BELT') || catUpper.includes('HAT') || catUpper.includes('BAG') || catUpper.includes('CAP')) {
        finalCategory = 'Accessories';
      }
    }
    
    return {
      brand: finalBrand,
      category: finalCategory,
      description: data.description || `High-quality ${productName} from Seekon.`,
    };
  } catch (err) {
    console.error('Error in analyzeProductWithAI:', err);
    return {
      brand: 'SEEKON',
      category: 'Sneakers',
      description: `High-quality ${productName} from Seekon.`
    };
  }
};

/**
 * parseProductPromptWithAI — Calls Groq (llama-3.3-70b-versatile) to parse a single-sentence product prompt
 * into name, price, sizes, colors, and stock in JSON mode.
 */
const parseProductPromptWithAI = async (sentence) => {
  try {
    const groq = getGroqClient();
    
    const systemPrompt = `You are a product parser for Seekon catalog.
Parse the following natural language sentence and extract the product details:
- name: The name of the product (e.g. "Nike Air Jordan 4 Black/White")
- price: The price of the product as a number (e.g. 8000). Extract from terms like "price 8000", "8,000", "8k", "8000 kes", etc.
- sizes: A comma-separated string of sizes or size ranges (e.g. "36-40" or "S, M, L").
- colors: A comma-separated string of colors (e.g. "Black, White" or "none").
- stock: The stock count as a number (default 200 if not found).

You must reply with a valid JSON object ONLY. The JSON keys must be:
- "name": string
- "price": number or null
- "sizes": string or null
- "colors": string or null
- "stock": number

Do NOT wrap the response in markdown blocks like \`\`\`json. Output raw JSON string only.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: sentence }
      ],
      response_format: { type: "json_object" }
    });

    const resultText = response.choices[0]?.message?.content || "{}";
    const data = JSON.parse(resultText);
    
    return {
      name: data.name || null,
      price: data.price || null,
      sizes: data.sizes || null,
      colors: data.colors || null,
      stock: typeof data.stock === 'number' ? data.stock : null
    };
  } catch (err) {
    console.error('Error parsing product sentence with AI:', err);
    return null;
  }
};

/**
 * askNextClarifyingField — Prompts the admin for the next missing field in the queue.
 */
const askNextClarifyingField = async (remoteJid, session) => {
  const nextField = session.data.missingFields[0];
  session.data.currentClarifyingField = nextField;
  
  if (nextField === 'name') {
    await sendSafeMessage(remoteJid, "🤖 *Product Name* was not found in your statement. Please reply with the *Product Name*:");
  } else if (nextField === 'price') {
    await sendSafeMessage(remoteJid, "🤖 *Product Price* was not found in your statement. Please reply with the *Product Price* (numbers only, e.g., 1500):");
  } else if (nextField === 'sizes') {
    await sendSafeMessage(remoteJid, "🤖 *Sizes* were not found in your statement. Please reply with the *Sizes* (comma-separated, e.g., S, M, L or 35-45 or reply *none* to skip):");
  } else if (nextField === 'colors') {
    await sendSafeMessage(remoteJid, "🤖 *Colors* were not found in your statement. Please reply with the *Colors* (comma-separated or reply *none* to skip):");
  } else if (nextField === 'stock') {
    await sendSafeMessage(remoteJid, "🤖 *Stock count* was not found in your statement. Please reply with the *Stock count* (or reply *none* to default to 200):");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Conversational WhatsApp Admin Panel — accepts product uploads from admins.
// ─────────────────────────────────────────────────────────────────────────────
const handleAdminPanelUpsert = async (messages) => {
  for (const msg of messages) {
    try {
      const remoteJid = msg.key?.remoteJid || '';
      const senderId = msg.key?.participant || msg.key?.remoteJid || '';

      // Ignore messages sent programmatically by the bot itself, but allow manual messages sent from a linked device
      if (msg.key?.id && sentMessageIds.has(msg.key.id)) continue;

      const isFromAdminGroup = adminGroupJid && remoteJid === adminGroupJid;
      const isDM = remoteJid.endsWith('@s.whatsapp.net');

      // Extract text content early for debugging/logging
      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        ''
      ).trim();

      // Debug log to trace incoming messages from DMs and any groups
      if (isDM || isFromAdminGroup || remoteJid.endsWith('@g.us')) {
        console.log(`📩 [WA-ADMIN-PANEL DEBUG]: remoteJid: "${remoteJid}", senderId: "${senderId}", isDM: ${isDM}, isFromAdminGroup: ${isFromAdminGroup}, configJid: "${adminGroupJid}", text: "${text}"`);
      }

      // Gate: only allow private DMs or messages within the specific Admin Group JID
      if (!isDM && !isFromAdminGroup) continue;

      const { authorizedPhones, authorizedLids } = await loadAuthorizedIdentifiers();
      const getBareJid = (jid) => jid ? jid.split('@')[0].split(':')[0] + '@s.whatsapp.net' : '';
      const botOwnJid = sock?.user?.id ? getBareJid(sock.user.id) : '';
      const isSenderOwnNumber = botOwnJid && getBareJid(senderId) === botOwnJid;
      const isSenderAdmin = isSenderOwnNumber || isSenderAuthorized(senderId, authorizedPhones, authorizedLids);

      // Gate: sender must be an authorized admin, OR the message must come from the admin group
      if (!isSenderAdmin && !isFromAdminGroup) continue;

      const isImage = !!(msg.message?.imageMessage);
      let session = adminUploadSessions.get(senderId);

      // 1. Session Initialization Check
      if (!session) {
        // Help command
        const helpCommands = ['!help', '/help', 'help'];
        const isHelpCommand = helpCommands.some(cmd => text.toLowerCase() === cmd);
        if (isHelpCommand) {
          const helpMessage = `🛠️ *Seekon Admin Bot Help* 🛠️\n\n` +
            `Use this bot to upload new products directly to the Seekon catalog. All uploads are processed asynchronously to ensure high stability.\n\n` +
            `*Available Commands:*\n` +
            `👉 *!addproduct* or */addproduct* - Start a new product upload session.\n` +
            `👉 *!help* or */help* - Display this help guide.\n` +
            `👉 *cancel* or *abort* - Stop the current upload session and delete temporary files.\n\n` +
            `*Size Selection Tip:*\n` +
            `When entering sizes, you can specify ranges like *35-45*. The bot will automatically expand it to include all sizes in between (*35, 36, 37... 45*). You can also mix them: *S, M, 35-40, L*.\n\n` +
            `*Upload Guide:*\n` +
            `1. Start the session using *!addproduct*.\n` +
            `2. Input the Product Name, Price (commas are supported), Sizes, and Colors.\n` +
            `3. Set the Stock count (defaults to 200 if skipped).\n` +
            `4. Send product images one by one, then type *done*.\n` +
            `5. Choose whether to run AI Background Removal (yes/no).\n` +
            `6. Verify the AI-generated details on the summary screen. Confirm by replying *yes*, or start over with *no*.\n\n` +
            `*Edit Option:*\n` +
            `If any details are incorrect on the summary screen, edit them directly by typing:\n` +
            `👉 *edit <field> <value>*\n` +
            `_(e.g., *edit price 8,000* or *edit stock 150* or *edit name New Nike Shoes*)_`;
          await sendSafeMessage(remoteJid, helpMessage);
          return;
        }

        const startCommands = ['/add product', '!add product', '/addproduct', '!addproduct', 'add product', 'new product'];
        const matchedStart = startCommands.find(cmd => text.toLowerCase().startsWith(cmd));

        if (matchedStart) {
          const sentence = text.slice(matchedStart.length).trim();
          
          session = {
            step: 'awaiting_name',
            data: {
              name: '',
              price: 0,
              sizes: [],
              colors: [],
              stock: 200,
              imagePaths: [],
              runBgRemoval: true,
              missingFields: []
            }
          };

          if (sentence) {
            await sendSafeMessage(remoteJid, "🤖 AI is parsing your product sentence... Please wait.");
            const parsed = await parseProductPromptWithAI(sentence);
            if (parsed) {
              session.data.name = parsed.name || '';
              session.data.price = parsed.price || 0;
              session.data.stock = parsed.stock !== null ? parsed.stock : 200;
              
              // Compile missing fields queue
              const missingFields = [];
              if (!parsed.name) missingFields.push('name');
              if (!parsed.price) missingFields.push('price');
              if (!parsed.sizes || parsed.sizes.toLowerCase() === 'none') missingFields.push('sizes');
              if (!parsed.colors || parsed.colors.toLowerCase() === 'none') missingFields.push('colors');
              
              session.data.missingFields = missingFields;

              const expandedSizes = [];
              if (parsed.sizes && parsed.sizes.toLowerCase() !== 'none') {
                const parts = parsed.sizes.split(',');
                for (const part of parts) {
                  const trimmed = part.trim();
                  if (!trimmed) continue;
                  const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
                  if (rangeMatch) {
                    const start = parseInt(rangeMatch[1], 10);
                    const end = parseInt(rangeMatch[2], 10);
                    if (start <= end && (end - start) <= 100) {
                      for (let i = start; i <= end; i++) expandedSizes.push(String(i));
                    } else {
                      expandedSizes.push(trimmed);
                    }
                  } else {
                    expandedSizes.push(trimmed);
                  }
                }
              }
              session.data.sizes = expandedSizes;
              
              if (parsed.colors && parsed.colors.toLowerCase() !== 'none') {
                session.data.colors = parsed.colors.split(',').map(c => c.trim()).filter(Boolean);
              }
              
              adminUploadSessions.set(senderId, session);

              if (missingFields.length > 0) {
                session.step = 'clarifying';
                let parsedSummary = `🤖 *AI Parsed Partial Details:* \n`;
                if (session.data.name) parsedSummary += `- *Name:* ${session.data.name}\n`;
                if (session.data.price) parsedSummary += `- *Price:* KES ${session.data.price}\n`;
                if (session.data.sizes.length > 0) parsedSummary += `- *Sizes:* ${session.data.sizes.join(', ')}\n`;
                if (session.data.colors.length > 0) parsedSummary += `- *Colors:* ${session.data.colors.join(', ')}\n`;
                parsedSummary += `\nLet's clarify the remaining fields:`;
                await sendSafeMessage(remoteJid, parsedSummary);
                await askNextClarifyingField(remoteJid, session);
                return;
              } else {
                session.step = 'awaiting_images';
                const parsedMsg = `🤖 *AI Parsed Details:* \n\n` +
                  `*Name:* ${session.data.name}\n` +
                  `*Price:* KES ${session.data.price}\n` +
                  `*Sizes:* ${session.data.sizes.join(', ') || 'None'}\n` +
                  `*Colors:* ${session.data.colors.join(', ') || 'None'}\n` +
                  `*Stock:* ${session.data.stock}\n\n` +
                  `📸 Please upload/send the *Product Image(s)* now (you can send multiple images in a batch). Reply *done* when finished:`;
                await sendSafeMessage(remoteJid, parsedMsg);
                return;
              }
            } else {
              await sendSafeMessage(remoteJid, "⚠️ AI was unable to parse the sentence. Falling back to step-by-step prompts.");
            }
          }

          adminUploadSessions.set(senderId, session);
          await sendSafeMessage(remoteJid, "📦 *Seekon WhatsApp Admin Panel* 📦\n\nStarting product upload session. Type *cancel* at any time to abort.\n\n👉 Please reply with the *Product Name*:\n\n💡 *Quick Tip*: You can also upload in one go! Next time, try sending:\n*/add product Nike Dunk Low Retro, price 8,500, sizes 36-45, colors panda, stock 150*");
          return;
        }
        continue;
      }

      // 2. Cancellation Check
      if (text.toLowerCase() === 'cancel' || text.toLowerCase() === 'abort') {
        if (session.data?.imagePaths) {
          for (const imgPath of session.data.imagePaths) {
            try {
              if (fs.existsSync(imgPath)) {
                fs.unlinkSync(imgPath);
              }
            } catch (e) {
              console.warn("⚠️ Failed to delete temp file:", e.message);
            }
          }
        }
        adminUploadSessions.delete(senderId);
        await sendSafeMessage(remoteJid, "❌ Session cancelled. All temporary files deleted.");
        return;
      }

      // 3. Conversational State Machine
      switch (session.step) {
        case 'clarifying': {
          const field = session.data.currentClarifyingField;
          
          if (field === 'name') {
            if (!text) {
              await sendSafeMessage(remoteJid, "⚠️ Invalid input. Please reply with the *Product Name*:");
              return;
            }
            session.data.name = text;
          } else if (field === 'price') {
            const priceStr = text.replace(/,/g, '').trim();
            const price = parseFloat(priceStr);
            if (isNaN(price) || price < 0) {
              await sendSafeMessage(remoteJid, "⚠️ Invalid price. Please reply with a valid number for the *Product Price*:");
              return;
            }
            session.data.price = price;
          } else if (field === 'sizes') {
            const expandedSizes = [];
            if (text && text.toLowerCase() !== 'none') {
              const parts = text.split(',');
              for (const part of parts) {
                const trimmed = part.trim();
                if (!trimmed) continue;
                const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
                if (rangeMatch) {
                  const start = parseInt(rangeMatch[1], 10);
                  const end = parseInt(rangeMatch[2], 10);
                  if (start <= end && (end - start) <= 100) {
                    for (let i = start; i <= end; i++) expandedSizes.push(String(i));
                  } else {
                    expandedSizes.push(trimmed);
                  }
                } else {
                  expandedSizes.push(trimmed);
                }
              }
            }
            session.data.sizes = expandedSizes;
          } else if (field === 'colors') {
            if (text && text.toLowerCase() !== 'none') {
              session.data.colors = text.split(',').map(c => c.trim()).filter(Boolean);
            }
          } else if (field === 'stock') {
            let stock = parseInt(text, 10);
            if (isNaN(stock) || stock < 0 || text.toLowerCase() === 'none') {
              stock = 200;
            }
            session.data.stock = stock;
          }

          // Move to next missing field
          session.data.missingFields.shift();
          
          if (session.data.missingFields.length > 0) {
            await askNextClarifyingField(remoteJid, session);
          } else {
            session.step = 'awaiting_images';
            await sendSafeMessage(remoteJid, `📸 All details loaded successfully! Please upload/send the *Product Image(s)* now (you can send multiple images in a batch). Reply *done* when finished:`);
          }
          break;
        }

        case 'awaiting_name':
          if (!text) {
            await sendSafeMessage(remoteJid, "⚠️ Invalid input. Please reply with the *Product Name*:");
            return;
          }
          session.data.name = text;
          session.step = 'awaiting_price';
          await sendSafeMessage(remoteJid, "💰 Great! Please reply with the *Product Price* (numbers only, e.g., 1500):");
          break;

        case 'awaiting_price': {
          const priceStr = text.replace(/,/g, '').trim();
          const price = parseFloat(priceStr);
          if (isNaN(price) || price < 0) {
            await sendSafeMessage(remoteJid, "⚠️ Invalid price. Please reply with a valid number for the *Product Price*:");
            return;
          }
          session.data.price = price;
          session.step = 'awaiting_sizes';
          await sendSafeMessage(remoteJid, "📏 Price saved! Please reply with the *Sizes* (comma-separated, e.g., S, M, L, XL or 35-45, or reply *none* to skip):");
          break;
        }

        case 'awaiting_sizes':
          if (text && text.toLowerCase() !== 'none') {
            const parts = text.split(',');
            const expandedSizes = [];
            for (const part of parts) {
              const trimmed = part.trim();
              if (!trimmed) continue;

              const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
              if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (start <= end && (end - start) <= 100) {
                  for (let i = start; i <= end; i++) {
                    expandedSizes.push(String(i));
                  }
                } else {
                  expandedSizes.push(trimmed);
                }
              } else {
                expandedSizes.push(trimmed);
              }
            }
            session.data.sizes = expandedSizes;
          }
          session.step = 'awaiting_colors';
          await sendSafeMessage(remoteJid, "🎨 Please reply with the *Colors* (comma-separated, e.g., Black, White, Red or reply *none* to skip):");
          break;

        case 'awaiting_colors':
          if (text && text.toLowerCase() !== 'none') {
            session.data.colors = text.split(',').map(c => c.trim()).filter(Boolean);
          }
          session.step = 'awaiting_stock';
          await sendSafeMessage(remoteJid, "📦 Please reply with the *Stock count* (or reply *none* to default to 200):");
          break;

        case 'awaiting_stock': {
          let stock = parseInt(text, 10);
          if (isNaN(stock) || stock < 0 || text.toLowerCase() === 'none') {
            stock = 200;
          }
          session.data.stock = stock;
          session.step = 'awaiting_images';
          await sendSafeMessage(remoteJid, "📸 Now, please upload/send the *Product Image(s)*. You can send multiple images one by one. Reply *done* when you are finished sending all images:");
          break;
        }

        case 'awaiting_images': {
          if (text.toLowerCase() === 'done') {
            if (session.data.imagePaths.length === 0) {
              await sendSafeMessage(remoteJid, "⚠️ Please upload at least one image before replying *done*.");
              return;
            }
            session.step = 'awaiting_bg_removal';
            await sendSafeMessage(remoteJid, "🤖 Would you like to run AI Background Removal on these images? Reply *yes* or *no*:");
            return;
          }

          if (isImage) {
            try {
              await sendSafeMessage(remoteJid, "📥 Downloading image...");
              const imageMessage = msg.message.imageMessage;
              const stream = await downloadContentFromMessage(imageMessage, 'image');
              let buffer = Buffer.from([]);
              for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
              }

              if (buffer.length > 0) {
                const queueDir = path.join(process.cwd(), 'uploads', 'queue');
                if (!fs.existsSync(queueDir)) {
                  fs.mkdirSync(queueDir, { recursive: true });
                }
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const tempFilePath = path.join(queueDir, `${uniqueSuffix}.jpg`);
                fs.writeFileSync(tempFilePath, buffer);
                session.data.imagePaths.push(tempFilePath);
                await sendSafeMessage(remoteJid, `✅ Image #${session.data.imagePaths.length} received! Send another or reply *done* to proceed.`);
              } else {
                await sendSafeMessage(remoteJid, "⚠️ Failed to download the image. Please try again.");
              }
            } catch (err) {
              console.error("Error downloading admin image:", err);
              await sendSafeMessage(remoteJid, `❌ Error processing image: ${err.message}`);
            }
          } else {
            await sendSafeMessage(remoteJid, "⚠️ Please send an image or reply *done* to proceed.");
          }
          break;
        }

        case 'awaiting_bg_removal': {
          const lowerText = text.toLowerCase();
          if (lowerText === 'yes' || lowerText === 'y') {
            session.data.runBgRemoval = true;
          } else if (lowerText === 'no' || lowerText === 'n') {
            session.data.runBgRemoval = false;
          } else {
            await sendSafeMessage(remoteJid, "⚠️ Invalid input. Would you like to run AI Background Removal? Reply *yes* or *no*:");
            return;
          }

          await sendSafeMessage(remoteJid, "🤖 AI is generating description, matching brand, and analyzing category from the product name... Please wait.");

          const existingBrands = await getExistingBrands();
          const aiResult = await analyzeProductWithAI(session.data.name, existingBrands);

          session.data.brand = aiResult.brand;
          session.data.category = aiResult.category;
          session.data.description = aiResult.description;

          session.step = 'confirming';
          const summary = `📝 *Product Summary* 📝\n\n` +
            `*Name:* ${session.data.name}\n` +
            `*AI Category:* ${session.data.category}\n` +
            `*AI Brand:* ${session.data.brand}\n` +
            `*Price:* KES ${session.data.price}\n` +
            `*Stock:* ${session.data.stock}\n` +
            `*Sizes:* ${session.data.sizes.join(', ') || 'None'}\n` +
            `*Colors:* ${session.data.colors.join(', ') || 'None'}\n` +
            `*Images:* ${session.data.imagePaths.length} attached\n` +
            `*AI Background Removal:* ${session.data.runBgRemoval ? 'Enabled ✅' : 'Disabled ❌'}\n` +
            `*AI Description:* _${session.data.description}_\n\n` +
            `Reply *yes* to confirm and upload, or *no* to start over.\n\n` +
            `💡 To edit a section, reply with:\n` +
            `👉 *edit name <new name>*\n` +
            `👉 *edit price <new price>*\n` +
            `👉 *edit sizes <new sizes>*\n` +
            `👉 *edit colors <new colors>*\n` +
            `👉 *edit stock <new stock>*\n` +
            `👉 *edit bg <yes/no>*`;
          await sendSafeMessage(remoteJid, summary);
          break;
        }

        case 'confirming': {
          const editMatch = text.match(/^\/?edit\s+(\w+)\s+(.+)$/i);
          if (editMatch) {
            const field = editMatch[1].toLowerCase();
            const value = editMatch[2].trim();

            if (field === 'price') {
              const priceStr = value.replace(/,/g, '').trim();
              const price = parseFloat(priceStr);
              if (isNaN(price) || price < 0) {
                await sendSafeMessage(remoteJid, "⚠️ Invalid price format. Example: *edit price 8,000*");
                return;
              }
              session.data.price = price;
              await sendSafeMessage(remoteJid, `✅ Price updated to KES ${price}.`);
            } else if (field === 'name') {
              if (!value) {
                await sendSafeMessage(remoteJid, "⚠️ Name cannot be empty.");
                return;
              }
              session.data.name = value;
              await sendSafeMessage(remoteJid, "⏳ Product name updated. Re-running AI analysis for brand, category, and description...");
              const existingBrands = await getExistingBrands();
              const aiResult = await analyzeProductWithAI(session.data.name, existingBrands);
              session.data.brand = aiResult.brand;
              session.data.category = aiResult.category;
              session.data.description = aiResult.description;
              await sendSafeMessage(remoteJid, "✅ AI analysis completed.");
            } else if (field === 'sizes') {
              const expandedSizes = [];
              if (value.toLowerCase() !== 'none') {
                const parts = value.split(',');
                for (const part of parts) {
                  const trimmed = part.trim();
                  if (!trimmed) continue;
                  const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
                  if (rangeMatch) {
                    const start = parseInt(rangeMatch[1], 10);
                    const end = parseInt(rangeMatch[2], 10);
                    if (start <= end && (end - start) <= 100) {
                      for (let i = start; i <= end; i++) expandedSizes.push(String(i));
                    } else {
                      expandedSizes.push(trimmed);
                    }
                  } else {
                    expandedSizes.push(trimmed);
                  }
                }
              }
              session.data.sizes = expandedSizes;
              await sendSafeMessage(remoteJid, `✅ Sizes updated to: ${expandedSizes.join(', ') || 'None'}`);
            } else if (field === 'colors') {
              const colors = value.toLowerCase() === 'none' ? [] : value.split(',').map(c => c.trim()).filter(Boolean);
              session.data.colors = colors;
              await sendSafeMessage(remoteJid, `✅ Colors updated to: ${colors.join(', ') || 'None'}`);
            } else if (field === 'stock') {
              let stock = parseInt(value, 10);
              if (isNaN(stock) || stock < 0 || value.toLowerCase() === 'none') {
                stock = 200;
              }
              session.data.stock = stock;
              await sendSafeMessage(remoteJid, `✅ Stock updated to ${stock}.`);
            } else if (field === 'bg' || field === 'background' || field === 'ai') {
              const bgVal = value.toLowerCase();
              if (bgVal === 'yes' || bgVal === 'y' || bgVal === 'true' || bgVal === 'enabled') {
                session.data.runBgRemoval = true;
              } else {
                session.data.runBgRemoval = false;
              }
              await sendSafeMessage(remoteJid, `✅ AI Background Removal set to: ${session.data.runBgRemoval ? 'Enabled' : 'Disabled'}`);
            } else {
              await sendSafeMessage(remoteJid, "⚠️ Unknown field. Available fields to edit: *name*, *price*, *sizes*, *colors*, *stock*, *bg*.\n\nExample: *edit price 8000*");
              return;
            }

            // Reshow the summary
            const summary = `📝 *Updated Product Summary* 📝\n\n` +
              `*Name:* ${session.data.name}\n` +
              `*AI Category:* ${session.data.category}\n` +
              `*AI Brand:* ${session.data.brand}\n` +
              `*Price:* KES ${session.data.price}\n` +
              `*Stock:* ${session.data.stock}\n` +
              `*Sizes:* ${session.data.sizes.join(', ') || 'None'}\n` +
              `*Colors:* ${session.data.colors.join(', ') || 'None'}\n` +
              `*Images:* ${session.data.imagePaths.length} attached\n` +
              `*AI Background Removal:* ${session.data.runBgRemoval ? 'Enabled ✅' : 'Disabled ❌'}\n` +
              `*AI Description:* _${session.data.description}_\n\n` +
              `Reply *yes* to confirm and upload, or *no* to start over.\n\n` +
              `💡 To edit a section, reply with:\n` +
              `👉 *edit name <new name>*\n` +
              `👉 *edit price <new price>*\n` +
              `👉 *edit sizes <new sizes>*\n` +
              `👉 *edit colors <new colors>*\n` +
              `👉 *edit stock <new stock>*\n` +
              `👉 *edit bg <yes/no>*`;
            await sendSafeMessage(remoteJid, summary);
            return;
          }

          if (text.toLowerCase() === 'yes') {
            await sendSafeMessage(remoteJid, "⏳ Saving product and queueing image processing job...");
            try {
              const product = await Product.create({
                name: session.data.name,
                description: session.data.description,
                price: session.data.price,
                category: session.data.category,
                brand: session.data.brand,
                sizes: session.data.sizes,
                colors: session.data.colors,
                stock: session.data.stock,
                status: 'processing'
              });

              await imageQueue.add('processImages', {
                productId: product._id.toString(),
                imagePaths: session.data.imagePaths,
                runAIBackgroundRemoval: session.data.runBgRemoval
              });

              await sendSafeMessage(remoteJid, `🎉 *Success!* Product "${session.data.name}" has been created as 'processing' with ID \`${product._id}\`. Background job handed off to Seekon BullMQ worker.`);
            } catch (dbErr) {
              console.error("Error creating product via WhatsApp Admin:", dbErr);
              await sendSafeMessage(remoteJid, `❌ Failed to save product: ${dbErr.message}`);
              // Cleanup files
              for (const imgPath of session.data.imagePaths) {
                try {
                  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
                } catch (e) {}
              }
            }
            adminUploadSessions.delete(senderId);
          } else if (text.toLowerCase() === 'no') {
            // Cleanup temp files
            for (const imgPath of session.data.imagePaths) {
              try {
                if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
              } catch (e) {}
            }
            adminUploadSessions.delete(senderId);
            await sendSafeMessage(remoteJid, "❌ Upload cancelled. Session cleared.");
          } else {
            await sendSafeMessage(remoteJid, "⚠️ Invalid input. Reply *yes* to confirm and upload, or *no* to cancel.");
          }
          break;
        }
      }
    } catch (err) {
      console.error("🔥 [WA-ADMIN-PANEL ERROR]:", err.message || err);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 + CORE — initWhatsAppClient: creates the Baileys WASocket
// ─────────────────────────────────────────────────────────────────────────────
export const initWhatsAppClient = async () => {
  console.log('📦 [WA]: Initializing Baileys WASocket (Chromium-free)...');

  // Ensure auth directory exists on disk
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    console.log(`📂 [WA]: Created auth directory at ${AUTH_DIR}`);
  }

  // STEP 2.1 — Multi-file auth state (QR scan credentials persisted to disk)
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // Fetch latest WhatsApp Web version supported by Baileys
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`🔖 [WA]: WA Web version ${version.join('.')} (isLatest: ${isLatest})`);

  // STEP 2.2 — Socket with custom browser fingerprint + silent logger (anti-ban)
  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // STEP 2.2 — Match browser fingerprint with reference project
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    // Memory optimisations for the 1 GB Azure instance
    syncFullHistory:              false,
    markOnlineOnConnect:          false,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => {
      const cacheKey = `${key.remoteJid}:${key.id}`;
      const cached = messageCache.get(cacheKey);
      return cached?.message || { conversation: '' };
    },
  });

  // Patch sock.sendMessage to automatically capture sent message IDs
  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const result = await originalSendMessage(jid, content, options);
    if (result?.key?.id) {
      sentMessageIds.add(result.key.id);
      if (sentMessageIds.size > 1000) {
        const oldestKey = sentMessageIds.values().next().value;
        sentMessageIds.delete(oldestKey);
      }
    }
    return result;
  };

  // Cache all incoming messages for the getMessage hook
  sock.ev.on('messages.upsert', ({ messages: msgs }) => {
    msgs.forEach(cacheMessage);
  });

  // ── Connection lifecycle ──────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      isConnected = false;
      console.log('📍 [WA]: QR Code received — scan in WhatsApp to authenticate.');
    }

    if (connection === 'open') {
      currentQR = null;
      isConnected = true;
      console.log('🚀 [WA]: Socket OPEN — Baileys authenticated and live!');

      // STEP 4 — Recovery: re-fire any tasks that were 'pending' when the
      // process was last killed. Runs async so it never blocks the open event.
      resumeDroppedTasks().catch(e =>
        console.error('⚠️ [WA-RECOVERY]: Startup recovery scan threw:', e.message)
      );
    }

    if (connection === 'close') {
      isConnected = false;
      currentQR = null;

      // Inspect close reason to decide reconnection strategy
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : lastDisconnect?.error?.output?.statusCode;

      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      console.warn(`⚠️ [WA]: Connection closed. StatusCode: ${statusCode} | LoggedOut: ${isLoggedOut}`);

      if (isLoggedOut) {
        // Explicit logout — wipe auth so next init produces a fresh QR
        console.log('🔐 [WA]: Explicit logout detected. Clearing auth credentials.');
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch (e) {
          console.warn('⚠️ [WA]: Could not clear auth directory:', e.message);
        }
      } else if (!isShuttingDown) {
        // Any other disconnect (network drop, server restart, etc.) → autonomous reconnect
        console.log('🔄 [WA]: Non-logout disconnect — autonomous reconnect in 30s...');

        // Non-blocking admin offline alert
        sendAdminOfflineAlertEmail().catch(e =>
          console.error('⚠️ [WA]: Admin offline email failed:', e.message)
        );

        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (!isShuttingDown) startWithRetry(1);
        }, 30000);
      }
    }
  });

  // ── Credential persistence ────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── STEP 4.1 — Status broadcast interception ─────────────────────────────
  // Handles ONLY status@broadcast messages. Never triggers lead capture.
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;
    await handleStatusUpsert(msgs);
  });

  // ── Lead capture — incoming customer DMs only ─────────────────────────────
  // Completely separate listener. Fires ONLY for @s.whatsapp.net remoteJids.
  // Status broadcasts, groups, and bot-sent messages are all ignored inside
  // handleDirectMessageUpsert before any DB or email operation is attempted.
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;
    await handleDirectMessageUpsert(msgs);
  });

  // ── Conversational Admin Panel ───────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;
    await handleAdminPanelUpsert(msgs);
  });

  console.log('✅ [WA]: Baileys socket initialized. All event listeners active.');
};

// ─────────────────────────────────────────────────────────────────────────────
// Retry wrapper — 3-attempt exponential back-off (mirrors old implementation)
// ─────────────────────────────────────────────────────────────────────────────
const startWithRetry = async (attempt = 1) => {
  try {
    await initWhatsAppClient();
  } catch (err) {
    console.error(`❌ [WA]: Initialization failed (Attempt ${attempt}/3):`, err.message || err);
    if (attempt < 3 && !isShuttingDown) {
      const delay = attempt * 15000; // 15s → 30s
      console.log(`🔄 [WA]: Retrying in ${delay / 1000}s...`);
      setTimeout(() => startWithRetry(attempt + 1), delay);
    } else {
      console.error('❌ [WA]: All retry attempts exhausted. Bot remains offline until manual restart.');
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Auto-start on module load (respects DISABLE_WHATSAPP env flag)
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.DISABLE_WHATSAPP !== 'true') {
  startWithRetry();
} else {
  console.log('🚫 [WA]: WhatsApp disabled via DISABLE_WHATSAPP environment variable.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown (SIGTERM from Azure / Ctrl+C in dev)
// ─────────────────────────────────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 [WA]: Received ${signal}. Closing Baileys socket gracefully...`);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try {
    if (sock) {
      sock.ev.removeAllListeners(); // detach all listeners before close
      await sock.end(undefined);    // clean WS teardown
    }
  } catch (e) {
    console.warn('⚠️ [WA]: Error during graceful socket close:', e.message);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ─────────────────────────────────────────────────────────────────────────────
// Shared phone formatter (used by sendSafeMessage + getAdminChat)
// ─────────────────────────────────────────────────────────────────────────────
const formatPhoneToJid = (phone) => {
  const formatted = normalizePhone(phone);
  return `${formatted}@s.whatsapp.net`;
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — identical surface area to old whatsapp-web.js wrapper.
//
// Consumers (orderController, paymentController, adminController, etc.) import:
//   import whatsappClient, { sendSafeMessage, getAdminChat, getRawClient,
//                            getStatus, logoutWhatsAppClient }
//     from '../config/whatsapp.js';
//
// ZERO changes needed in any of those files.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sendSafeMessage — drop-in replacement.
 * STEP 2: Applies jitter delay + composing presence before every outbound text.
 *
 * @param {*}      _ignored   Old API passed `whatsappClient`; Baileys is module-global
 * @param {string} phone      Raw phone number or 'me'/'self'
 * @param {string} message    Text to send
 * @param {number} attempt    Internal retry counter (default 1)
 */
export const sendSafeMessage = async (_ignored, phone, message, attempt = 1) => {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp Client is offline or not authenticated yet.');
  }

  let finalPhone = phone;
  let finalMessage = message;

  // Auto-shift arguments if called as sendSafeMessage(jid, text) instead of sendSafeMessage(null, jid, text)
  if (typeof _ignored === 'string' && typeof phone === 'string' && message === undefined) {
    finalPhone = _ignored;
    finalMessage = phone;
  }

  try {
    let chatId;
    if (finalPhone === 'me' || finalPhone === 'self') {
      const ownJid = sock.user?.id;
      if (!ownJid) throw new Error('Bot JID not yet loaded — cannot message self.');
      chatId = ownJid;
    } else if (finalPhone && (finalPhone.endsWith('@s.whatsapp.net') || finalPhone.endsWith('@g.us'))) {
      chatId = finalPhone;
    } else {
      chatId = formatPhoneToJid(finalPhone);
    }

    console.log(`📱 [WA-SEND]: Routing to ${chatId} (Attempt ${attempt}/3)`);

    // STEP 2 — Human-like jitter + composing presence before every send
    await humanDelay(1500, 5000);
    await simulateTyping(chatId, finalMessage);

    const withTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      ),
    ]);

    const result = await withTimeout(
      sock.sendMessage(chatId, { text: finalMessage }),
      60000,
      'sendMessage'
    );

    console.log(`✅ [WA-SEND]: Message delivered to ${chatId}`);
    return result;

  } catch (error) {
    console.error(`❌ [WA-SEND]: Attempt ${attempt} failed: ${error.message}`);
    if (attempt < 3) {
      const waitTime = attempt * 5000; // 5s, 10s
      console.log(`🔄 [WA-SEND]: Retrying in ${waitTime / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return sendSafeMessage(_ignored, phone, message, attempt + 1);
    }
    throw error;
  }
};

/**
 * getAdminChat — resolves the admin WhatsApp group chat.
 * Returns a duck-typed object with a sendMessage() method so the existing
 * call sites in orderController work without modification.
 *
 * @param {*} _ignored  Old API passed the client instance — no longer needed
 */
export const getAdminChat = async (_ignored) => {
  if (!sock || !isConnected) return null;

  const groupId = process.env.ADMIN_WHATSAPP_GROUP_ID;
  if (!groupId) {
    console.warn('⚠️ [WA]: ADMIN_WHATSAPP_GROUP_ID not set — admin group chat unavailable.');
    return null;
  }

  // Duck-typed wrapper matching the old wwebjs chat.sendMessage() API
  return {
    sendMessage: async (text) => {
      await humanDelay(1500, 5000);
      await simulateTyping(groupId, text);
      return sock.sendMessage(groupId, { text });
    },
  };
};

/**
 * logoutWhatsAppClient — force-logout, wipe credentials, reinit for fresh QR.
 */
export const logoutWhatsAppClient = async () => {
  console.log('🛑 [WA]: Force logout requested...');
  try {
    if (sock && isConnected) await sock.logout();
  } catch (e) {
    console.warn('⚠️ [WA]: Error during logout():', e.message);
  }
  try {
    if (sock) {
      sock.ev.removeAllListeners();
      await sock.end(undefined);
    }
  } catch (e) {}

  sock = null;
  isConnected = false;

  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      console.log(`🗑️ [WA]: Auth directory cleared: ${AUTH_DIR}`);
    }
  } catch (e) {
    console.error('❌ [WA]: Failed to clear auth directory:', e.message);
  }

  console.log('🔄 [WA]: Reinitializing — a fresh QR will be generated...');
  await initWhatsAppClient();
};

/**
 * getRawClient — returns the raw Baileys WASocket instance.
 */
export const getRawClient = () => sock;

/**
 * getStatus — connection status + QR string for the admin dashboard API.
 */
export const getStatus = () => ({
  connected: isConnected,
  qr: currentQR,
});

/**
 * Request a pairing code for logging in via phone number instead of QR.
 * @param {string} phone - The phone number to request a pairing code for.
 */
export const requestPairingCode = async (phone) => {
  if (isConnected) {
    throw new Error('WhatsApp is already connected.');
  }

  // Use the same formatter logic
  const formatted = normalizePhone(phone);

  console.log(`🔄 [WA-PAIRING]: Killing existing socket and clearing QR to request pairing code for ${formatted}...`);
  currentQR = null;

  if (sock) {
    try {
      sock.ev.removeAllListeners();
      await sock.end(undefined);
    } catch (e) {
      console.warn('⚠️ [WA-PAIRING]: Error closing socket:', e.message);
    }
  }

  // Re-initialize socket
  await initWhatsAppClient();

  // Wait a moment to ensure socket has registered its internal state (increased to 4000ms for VPS network latency)
  await new Promise(resolve => setTimeout(resolve, 4000));

  console.log(`📞 [WA-PAIRING]: Requesting pairing code for ${formatted} on fresh socket...`);
  const code = await sock.requestPairingCode(formatted);
  return code;
};

// ─────────────────────────────────────────────────────────────────────────────
// Default export — duck-typed to match the old `whatsappClient` object.
// orderController.js imports this as default; shape preserved exactly.
// ─────────────────────────────────────────────────────────────────────────────
const whatsappClient = {
  /**
   * Low-level send — used by getAdminChat().sendMessage and adminController.
   */
  sendMessage: (jid, content, ...rest) => {
    if (!sock || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
    return sock.sendMessage(jid, content, ...rest);
  },

  /**
   * Check if a JID is registered on WhatsApp.
   */
  isRegisteredUser: async (jid) => {
    if (!sock || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
    const [result] = await sock.onWhatsApp(jid);
    return result?.exists ?? false;
  },

  /**
   * Returns a duck-typed chat object with a sendMessage() method.
   * Mirrors the old client.getChatById() + chat.sendMessage() pattern.
   */
  getChatById: async (jid) => {
    if (!sock || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
    return {
      sendMessage: async (text) => {
        await humanDelay(1500, 5000);
        await simulateTyping(jid, text);
        return sock.sendMessage(jid, { text });
      },
    };
  },

  /**
   * Returns all chats from the in-memory store.
   */
  getChats: () => {
    if (!sock || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
    // Return empty array — full chat list not needed for Seekon's use case
    return [];
  },
};

export default whatsappClient;
