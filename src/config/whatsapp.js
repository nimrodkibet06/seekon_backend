// ============================================================
//  Seekon Apparel — WhatsApp Engine
//  Library : @whiskeysockets/baileys  (WebSocket, no Chromium)
//  Replaces: whatsapp-web.js + puppeteer
//  Purpose : OOM-safe connection, status scraping, outbound
//            order/payment notifications.
// ============================================================

import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import { useMongoDBAuthState, clearAuthData } from './mongoAuthState.js';
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
 * analyzeProductWithAI — Calls Groq (openai/gpt-oss-120b) to deduce brand,
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
      model: "openai/gpt-oss-120b",
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
 * expandSizeRange — Normalizes and expands size strings/ranges.
 * e.g. "35 to 50", "35-50", "35 - 50", "35 through 50" -> ["35", "36", ..., "50"]
 * Also handles standard sizes like ["S", "M", "L", "XL"].
 */
const expandSizeRange = (sizesInput) => {
  if (!sizesInput) return [];
  const rawList = Array.isArray(sizesInput)
    ? sizesInput
    : String(sizesInput).split(/[,/]/);

  const result = [];
  for (const item of rawList) {
    if (!item) continue;
    const str = String(item).trim();
    if (!str || str.toLowerCase() === 'none') continue;

    // Check for numeric range e.g. "35 to 50", "35-50", "35 - 50", "35..50", "35 through 50"
    const rangeMatch = str.match(/^(\d+)\s*(?:-|to|\.\.|through)\s*(\d+)$/i);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start <= end && (end - start) <= 100) {
        for (let i = start; i <= end; i++) {
          result.push(String(i));
        }
        continue;
      }
    }
    result.push(str);
  }
  return [...new Set(result)];
};

/**
 * cleanPrice — Normalizes raw price representation to a positive number.
 * Handles numbers and strings like "5000", "5,000", "5k", "5.5k", "5000 bob", "kes 5000", "5000/="
 */
const cleanPrice = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) || val <= 0 ? null : val;
  const str = String(val).toLowerCase().trim();
  
  // Check for 'k' multiplier e.g. "5k", "5.5k", "8.2k", "5 k" (word boundary or non-word)
  // Must not falsely match words containing k like "kes", "ksh", "black", "nike"
  const kMatch = str.match(/(?:^|[^\w])([\d.]+)\s*k(?:\b|[^\w]|$)/i);
  if (kMatch) {
    const num = parseFloat(kMatch[1]);
    if (!isNaN(num) && num > 0) return Math.round(num * 1000);
  }

  const cleanStr = str.replace(/,/g, '').replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleanStr);
  return !isNaN(parsed) && parsed > 0 ? parsed : null;
};

/**
 * processProductConversationWithAI — Uses Groq (openai/gpt-oss-120b)
 * to intelligently analyze conversation for product upload requirements,
 * acknowledge provided details, request missing pieces naturally,
 * and handle natural updates without strict commas or rigid formatting.
 */
const processProductConversationWithAI = async ({
  userMessage,
  currentData,
  conversationHistory = [],
  existingBrands = []
}) => {
  try {
    const groq = getGroqClient();

    const systemPrompt = `You are an intelligent, conversational product catalog manager for Seekon (a premium sneaker and apparel store in Kenya).
You are chatting with a store administrator on WhatsApp who is adding products to the catalog.

UPLOAD REQUIREMENTS FOR A COMPLETE PRODUCT:
1. Name: Specific product name (e.g., "Nike Dunk Low Retro", "Adidas Samba OG", "Essentials Hoodie")
2. Price: Selling price in Kenyan Shillings (KES). Handle any natural format like 5000, 5k, 5,000, 5000 bob, 5000 kes, 5000/=
3. Sizes: (e.g. "35 to 50", "36-45", "S, M, L, XL", or specific sizes like 40, 41, 42)
4. Colors: (e.g. "Red", "Black/White", "Navy Blue")
5. Stock: (number of items, default 200 if not specified by the admin)

DERIVED FIELDS (deduce and polish):
- Brand: Deduce the brand from the product name, matching existing store brands if possible: [${existingBrands.slice(0, 30).join(', ')}]. Default to 'SEEKON' if unknown.
- Category: Must be exactly one of: "Sneakers", "Apparel", or "Accessories".
- Description: Write a compelling, persuasive product description for the web store. It must be exactly 4-5 sentences long. Structure it as: (1) a strong opener about the product's identity or heritage, (2) standout features or materials, (3) how it fits/feels or lifestyle appeal, (4) a closing statement about why it belongs in the buyer's collection. Do NOT use markdown asterisks, hashtags, or generic filler openers like "Introducing" or "Meet the".

CURRENT PRODUCT DATA COLLECTED SO FAR:
${JSON.stringify(currentData, null, 2)}

YOUR INSTRUCTIONS:
1. Analyze the user's latest message in context of the conversation.
2. Extract or update any details: name, price, sizes, colors, stock, brand, category, description. If the user mentions changing something (e.g., "actually make the price 4500" or "color is blue not red"), update that field.
3. Check for special intents:
   - runBgRemoval: boolean or null (if the user mentioned yes/no, enable/disable for AI background removal).
   - isDone: boolean (true if user indicates they are finished sending images or ready to publish, e.g. "done", "upload", "finish", "proceed", "ready", "publish").
   - isCancel: boolean (true if user wants to cancel or abort the upload session).
4. Determine what required fields are still missing among: [name, price, sizes, colors]. Note: stock defaults to 200 if omitted.
5. Generate "naturalReply":
   - Speak naturally, warmly, and concisely like a helpful human assistant on WhatsApp.
   - Do NOT expect rigid commands or specific punctuation like commas.
   - If ANY of [name, price, sizes, colors] are still missing:
     Acknowledge what is already captured, and clearly ask for what is missing in a warm, conversational tone.
   - If ALL [name, price, sizes, colors] are provided:
     Provide a neat summary of the product (Name, Brand, Category, Price, Sizes, Colors, Stock, Description).
     Instruct the user to send the product photo(s), let you know if they want AI background removal applied (yes/no), and reply "done" when finished sending photos.

YOU MUST REPLY WITH A VALID JSON OBJECT ONLY with this schema:
{
  "name": string or null,
  "price": number or null,
  "sizes": array of strings or null,
  "colors": array of strings or null,
  "stock": number or null,
  "brand": string or null,
  "category": "Sneakers" | "Apparel" | "Accessories" or null,
  "description": string or null,
  "runBgRemoval": boolean or null,
  "isDone": boolean,
  "isCancel": boolean,
  "naturalReply": string
}

Do NOT wrap in markdown code fences like \`\`\`json. Output raw JSON string only.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-4),
      { role: "user", content: userMessage }
    ];

    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages,
      response_format: { type: "json_object" }
    });

    const resultText = response.choices[0]?.message?.content || "{}";
    let data;
    try {
      data = JSON.parse(resultText);
    } catch (parseErr) {
      console.warn("⚠️ [WA-GROQ]: JSON parse error on Groq response:", parseErr.message);
      data = {};
    }
    return data;
  } catch (err) {
    console.error("❌ [WA-GROQ]: Error in processProductConversationWithAI:", err.message);
    return null;
  }
};

/**
 * finalizeAndPublishProduct — Saves the product to MongoDB and enqueues the image processing job.
 * Hardened: separates DB and queue failures, always cleans up session, never leaks temp files.
 */
const finalizeAndPublishProduct = async (remoteJid, senderId, session) => {
  await sendSafeMessage(remoteJid, "⏳ Saving product and queuing image processing...");
  let product = null;
  try {
    // ── Step 1: Save to MongoDB ────────────────────────────────────────────
    product = await Product.create({
      name: session.data.name,
      description: session.data.description || `High quality ${session.data.name} from Seekon.`,
      price: session.data.price,
      category: session.data.category || 'Sneakers',
      brand: session.data.brand || 'SEEKON',
      sizes: session.data.sizes || [],
      colors: session.data.colors || [],
      stock: typeof session.data.stock === 'number' ? session.data.stock : 200,
      status: 'processing'
    });
  } catch (dbErr) {
    console.error("❌ [WA-ADMIN]: MongoDB create failed:", dbErr.message);
    await sendSafeMessage(remoteJid,
      `❌ Failed to save product to database: ${dbErr.message}\n\nPlease try again or contact support.`
    );
    // Cleanup temp images since product was never saved
    for (const imgPath of (session.data?.imagePaths || [])) {
      try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
    }
    adminUploadSessions.delete(senderId);
    return;
  }

  try {
    // ── Step 2: Enqueue image processing job ──────────────────────────────
    await imageQueue.add('processImages', {
      productId: product._id.toString(),
      imagePaths: session.data.imagePaths,
      runAIBackgroundRemoval: session.data.runBgRemoval
    });
  } catch (queueErr) {
    console.error("❌ [WA-ADMIN]: BullMQ/Redis enqueue failed:", queueErr.message);
    // Product IS saved — don't delete it. Warn admin so they can re-trigger manually.
    await sendSafeMessage(remoteJid,
      `⚠️ Product *${session.data.name}* (ID: \`${product._id}\`) was saved to the database, ` +
      `but the image processing job could not be queued (Redis may be down).\n\n` +
      `Please inform the dev team to manually enqueue images for product ID \`${product._id}\`.`
    );
    adminUploadSessions.delete(senderId);
    return;
  }

  // ── Step 3: All good — send success summary ────────────────────────────
  const bgText = session.data.runBgRemoval ? 'Enabled ✅' : 'Disabled ❌';
  const successMsg =
    `🎉 *Product Created!* ✅\n\n` +
    `*${session.data.name}*\n` +
    `💰 Price: KES ${session.data.price.toLocaleString()}\n` +
    `📐 Sizes: ${(session.data.sizes || []).join(', ')}\n` +
    `🎨 Colors: ${(session.data.colors || []).join(', ')}\n` +
    `📦 Stock: ${session.data.stock}\n` +
    `📸 Photos: ${session.data.imagePaths.length} queued\n` +
    `🤖 Background Removal: ${bgText}\n\n` +
    `ID: \`${product._id}\`\n\n` +
    `The product is processing in the background and will go live once images are ready!`;

  await sendSafeMessage(remoteJid, successMsg);
  adminUploadSessions.delete(senderId);
};

// ─────────────────────────────────────────────────────────────────────────────
// GHOST MODE — Bidirectional multi-image silent product extractor
//              for the buyer showcase group (BUYER_GROUP_JID).
//
// HOW IT WORKS:
//   Every message (image or text) from a sender in the buyer group is buffered
//   for 5 seconds. After 5 s of silence the buffer is evaluated:
//
//   Case A — images + text  → Groq extract → MongoDB + BullMQ
//   Case B — images, no text → alert admin ("you forgot the product details!")
//   Case C — text only       → silent discard (buyer chatting, do nothing)
//
// STRICT: NEVER sends a message to BUYER_GROUP_JID.
//         All notifications go ONLY to ADMIN_GROUP_JID.
// ─────────────────────────────────────────────────────────────────────────────
const rawBuyerGroupJid = process.env.BUYER_GROUP_JID || '';
const buyerGroupJid    = rawBuyerGroupJid.replace(/['"]/g, '').trim();

// ghostSessions: keyed by senderId, holds the 5-second rolling buffer
// Shape: { images: string[], texts: string[], timer: Timeout|null }
const ghostSessions = new Map();

// ── Ghost Mode helpers ────────────────────────────────────────────────────────

const ghostNotify = async (message) => {
  if (!adminGroupJid) return;
  try {
    await sendSafeMessage(adminGroupJid, message);
  } catch (err) {
    console.error('❌ [GHOST]: Could not notify admin group:', err.message);
  }
};

const streamImageToDisk = async (imageMessage, destPath) => {
  const stream = await downloadContentFromMessage(imageMessage, 'image');
  await new Promise((resolve, reject) => {
    const fsStream = fs.createWriteStream(destPath);
    fsStream.on('finish', resolve);
    fsStream.on('error', reject);
    stream.on('error', reject);
    stream.on('data', (chunk) => {
      if (!fsStream.write(chunk)) {
        stream.pause?.();
        fsStream.once('drain', () => stream.resume?.());
      }
    });
    stream.on('end', () => fsStream.end());
  });
};

const extractProductFromCaption = async (caption) => {
  const groq = getGroqClient();
  const systemPrompt = `You are a product data extractor for a sneaker/apparel online store called Seekon.

Given a WhatsApp message from an admin posting a product in the buyer showcase group, extract product details and return ONLY valid JSON matching this exact schema:
{
  "isProduct": true,
  "name": "full product name",
  "brand": "brand name",
  "category": "Sneakers" | "Apparel" | "Accessories",
  "subCategory": "optional sub-category string or empty string",
  "price": <number>,
  "sizes": ["array", "of", "size", "strings"],
  "colors": ["array", "of", "color", "strings"],
  "description": "4-5 sentence compelling product description. Strong opener, standout features, fit/feel, why it belongs in buyer collection. No generic openers like Introducing or Meet the.",
  "runBgRemoval": false
}

If the message is NOT a product (e.g. greetings, buyer questions, random chatter), return:
{ "isProduct": false }

RULES:
- Price: "5k"=5000, "5,000"=5000, "5000 bob"=5000, "KES 5000"=5000, "5000/="=5000.
- Sizes: "35 to 45" or "35-45" → ["35","36","37","38","39","40","41","42","43","44","45"]. "S M L" → ["S","M","L"].
- If price missing, set price: 0 but keep isProduct: true.
- Category must be exactly: Sneakers, Apparel, or Accessories.
- runBgRemoval: ONLY set to true if the admin explicitly says "remove background" or "clear background". Otherwise always output false.
- Output raw JSON only. No markdown, no code fences.`;

  const response = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract product from this message: ${caption}` }
    ],
    response_format: { type: 'json_object' }
  });

  const raw = response?.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;
  return JSON.parse(raw);
};

/**
 * Fired when the 5-second buffer timer expires for a given sender.
 * Evaluates accumulated images + texts and takes the correct action.
 */
const evaluateGhostSession = async (senderId) => {
  const session = ghostSessions.get(senderId);
  ghostSessions.delete(senderId); // always clean up first

  if (!session) return;

  const hasImages = session.images.length > 0;
  const hasText   = session.texts.length  > 0;

  console.log(`👻 [GHOST]: Evaluating session for ${senderId} — images=${session.images.length}, texts=${session.texts.length}`);

  // ── Case C: Text only (buyer chatting) ─────────────────────────────────
  // Silently discard. Do NOT notify admin, do NOT respond.
  if (!hasImages && hasText) {
    console.log(`👻 [GHOST]: Case C — text-only from ${senderId}. Silently discarding.`);
    return;
  }

  // ── Case B: Images, no text ─────────────────────────────────────────────
  if (hasImages && !hasText) {
    console.log(`👻 [GHOST]: Case B — ${session.images.length} image(s), no product details. Alerting admin.`);
    // Clean up orphaned temp images
    for (const imgPath of session.images) {
      try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
    }
    await ghostNotify(
      `📸 *[Ghost Mode — Missing Details]*\n\n` +
      `Hey! ${session.images.length} image${session.images.length > 1 ? 's were' : ' was'} dropped in the showcase group without any product text.\n\n` +
      `I need the product details to upload ${session.images.length > 1 ? 'them' : 'it'} — at minimum the *name* and *price*. The caption can be sent separately, just make sure it arrives within a few seconds of the photo.\n\n` +
      `_Temp file${session.images.length > 1 ? 's' : ''} deleted to save disk space._`
    );
    return;
  }

  // ── Case A: Images + Text → full ingestion pipeline ────────────────────
  if (hasImages && hasText) {
    const combinedText = session.texts.join(' ');
    console.log(`👻 [GHOST]: Case A — running Groq extraction on: "${combinedText.slice(0, 80)}..."`);

    // Groq extraction
    let parsed;
    try {
      parsed = await extractProductFromCaption(combinedText);
    } catch (groqErr) {
      console.error('❌ [GHOST]: Groq extraction failed:', groqErr.message);
      for (const imgPath of session.images) {
        try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
      }
      await ghostNotify(
        `🚨 *[Ghost Mode — AI Error]*\n\n` +
        `I tried to extract product details from the showcase message but the AI hit an error.\n\n` +
        `*Error:* ${groqErr.message}\n` +
        `*Text snippet:* _"${combinedText.slice(0, 80)}"_\n\n` +
        `The temp images have been deleted. Please re-post when ready.`
      );
      return;
    }

    // AI rejected as non-product
    if (!parsed || parsed.isProduct === false) {
      console.log(`👻 [GHOST]: Groq says not a product. Discarding.`);
      for (const imgPath of session.images) {
        try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
      }
      await ghostNotify(
        `🤷 *[Ghost Mode — Not a Product]*\n\n` +
        `Images were posted in the showcase group alongside some text, but the AI couldn't identify it as a product listing.\n\n` +
        `*Text snippet:* _"${combinedText.slice(0, 100)}"_\n\n` +
        `If this was supposed to be a product, try re-posting with a clearer caption (name, price, sizes, colors).`
      );
      return;
    }

    // Missing vital fields
    const missingFields = [];
    if (!parsed.name || String(parsed.name).trim().length < 2) missingFields.push('Name');
    if (!parsed.price || parsed.price <= 0) missingFields.push('Price');

    if (missingFields.length > 0) {
      console.log(`👻 [GHOST]: Missing vital fields: ${missingFields.join(', ')}`);
      for (const imgPath of session.images) {
        try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
      }
      await ghostNotify(
        `⚠️ *[Ghost Mode — Incomplete Details]*\n\n` +
        `The AI found a product in the showcase group but couldn't get everything it needs.\n\n` +
        `*Missing:* ${missingFields.join(', ')}\n` +
        `*What I got:* _"${combinedText.slice(0, 100)}"_\n\n` +
        `Please make sure the *name* and *price* are clearly mentioned in the caption, then re-post.`
      );
      return;
    }

    // Normalize fields
    const normalizedPrice    = cleanPrice(parsed.price) || parsed.price;
    const normalizedSizes    = expandSizeRange(parsed.sizes);
    const normalizedColors   = Array.isArray(parsed.colors)
      ? parsed.colors.map(c => String(c).trim()).filter(Boolean)
      : [];
    const validCategories    = ['Sneakers', 'Apparel', 'Accessories'];
    const normalizedCategory = validCategories.includes(parsed.category) ? parsed.category : 'Sneakers';

    // Create MongoDB product
    let newProduct;
    try {
      newProduct = await Product.create({
        name:        String(parsed.name).trim().slice(0, 120),
        brand:       (parsed.brand || 'SEEKON').trim().slice(0, 60),
        category:    normalizedCategory,
        subCategory: (parsed.subCategory || '').trim().slice(0, 60),
        price:       normalizedPrice,
        sizes:       normalizedSizes,
        colors:      normalizedColors,
        description: (parsed.description || '').trim().slice(0, 1200),
        stock:       200,
        status:      'processing',
        image:       '',
        images:      [],
        inStock:     true
      });
      console.log(`📦 [GHOST]: Product created in MongoDB: ${newProduct._id} with ${session.images.length} image(s)`);
    } catch (dbErr) {
      console.error('❌ [GHOST]: MongoDB create failed:', dbErr.message);
      for (const imgPath of session.images) {
        try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
      }
      await ghostNotify(
        `🚨 *[Ghost Mode — Database Error]*\n\n` +
        `The product details were extracted successfully but I couldn't save it to the database.\n\n` +
        `*Product:* ${parsed.name}\n` +
        `*Error:* ${dbErr.message}\n\n` +
        `The temp images have been deleted. Please re-post when ready.`
      );
      return;
    }

    // Dispatch BullMQ job with ALL accumulated images
    try {
      await imageQueue.add('processImages', {
        productId:              newProduct._id.toString(),
        imagePaths:             session.images,
        runAIBackgroundRemoval: parsed.runBgRemoval === true
      });
      console.log(`🚀 [GHOST]: BullMQ job dispatched for ${newProduct._id} (${session.images.length} images)`);
    } catch (queueErr) {
      console.error('⚠️ [GHOST]: BullMQ enqueue failed (product saved):', queueErr.message);
      await ghostNotify(
        `⚠️ *[Ghost Mode — Queue Warning]*\n\n` +
        `The product was saved to the database but the image processing job failed to queue. You'll need to trigger background removal manually.\n\n` +
        `*Product:* ${parsed.name}\n` +
        `*Mongo ID:* ${newProduct._id}\n` +
        `*Error:* ${queueErr.message}`
      );
      return;
    }

    // ✅ Full success
    await ghostNotify(
      `✅ *Got it! Product captured from showcase group.*\n\n` +
      `*${parsed.name}* has been saved and queued for background removal on all ${session.images.length} image${session.images.length > 1 ? 's' : ''}.\n\n` +
      `*Brand:* ${parsed.brand || 'SEEKON'}\n` +
      `*Category:* ${normalizedCategory}\n` +
      `*Price:* KES ${Number(normalizedPrice).toLocaleString()}\n` +
      `*Sizes:* ${normalizedSizes.length} size${normalizedSizes.length !== 1 ? 's' : ''} (${normalizedSizes.slice(0, 5).join(', ')}${normalizedSizes.length > 5 ? '...' : ''})\n` +
      `*Colors:* ${normalizedColors.join(', ') || 'N/A'}\n` +
      `*Images queued:* ${session.images.length}\n` +
      `*Stock:* 200\n` +
      `*ID:* ${newProduct._id}`
    );
  }
};

/**
 * handleBuyerGroupGhostMode — fires on every messages.upsert event.
 * Buffers each sender's messages for 5 s, then evaluates the session.
 */
const handleBuyerGroupGhostMode = async (messages) => {
  if (!buyerGroupJid) return;

  const uploadDir = process.env.GHOST_UPLOAD_DIR || './uploads/queue';
  try {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  } catch (_) {}

  for (const msg of messages) {
    try {
      const remoteJid = msg.key?.remoteJid || '';
      if (remoteJid !== buyerGroupJid) continue;
      if (msg.key?.fromMe) continue;
      if (msg.key?.id && sentMessageIds.has(msg.key.id)) continue;

      const senderId = msg.key?.participant || msg.key?.remoteJid || '';
      const isImage  = !!(msg.message?.imageMessage);
      const text     = (
        msg.message?.imageMessage?.caption ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.conversation ||
        ''
      ).trim();

      console.log(`👻 [GHOST]: Buffering msg from ${senderId} — isImage=${isImage}, textLen=${text.length}`);

      // Initialise session if first message from this sender
      if (!ghostSessions.has(senderId)) {
        ghostSessions.set(senderId, { images: [], texts: [], timer: null });
      }

      const session = ghostSessions.get(senderId);

      // Accumulate text
      if (text) session.texts.push(text);

      // Stream image to disk and accumulate path
      if (isImage) {
        const tempFileName = `ghost_${senderId.replace(/[^a-z0-9]/gi, '')}_${Date.now()}.jpg`;
        const tempFilePath = path.join(uploadDir, tempFileName);
        try {
          await streamImageToDisk(msg.message.imageMessage, tempFilePath);
          session.images.push(tempFilePath);
          console.log(`💾 [GHOST]: Image #${session.images.length} buffered → ${tempFilePath}`);
        } catch (streamErr) {
          console.error('❌ [GHOST]: Image stream failed:', streamErr.message);
          await ghostNotify(
            `🚨 *[Ghost Mode — Stream Error]*\n\n` +
            `Failed to save an image from the showcase group to disk.\n` +
            `*Error:* ${streamErr.message}`
          );
        }
      }

      // If we already have a caption, we only wait a short 4-second debounce 
      // just in case they sent an album of multiple images at once.
      // If we don't have a caption yet, we give them a full 60 seconds to type one.
      const waitTime = session.texts.length > 0 ? 4000 : 60000;

      if (session.timer) clearTimeout(session.timer);
      session.timer = setTimeout(() => {
        evaluateGhostSession(senderId).catch(err => {
          console.error('🔥 [GHOST]: evaluateGhostSession threw:', err.message);
        });
      }, waitTime);

    } catch (err) {
      console.error('🔥 [GHOST-ERROR]:', err.message || err);
      try {
        await ghostNotify(
          `🚨 *[Ghost Mode — Unexpected Error]*\n\nError: ${err.message}`
        );
      } catch (_) {}
    }
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// Conversational WhatsApp Admin Panel — accepts product uploads from admins.
// ─────────────────────────────────────────────────────────────────────────────
const handleAdminPanelUpsert = async (messages) => {
  for (const msg of messages) {
    try {
      const remoteJid = msg.key?.remoteJid || '';

      // ── Linked-device support ────────────────────────────────────────────
      // When the admin types from a linked device (WhatsApp Web / secondary phone),
      // msg.key.fromMe = true and msg.key.participant is undefined for DMs.
      // In that case msg.key.remoteJid is the RECIPIENT, not the sender.
      // We resolve senderId to the bot's own JID for fromMe DMs so auth passes.
      const isFromMe = msg.key?.fromMe === true;
      const getBareJid = (jid) => jid ? jid.split('@')[0].split(':')[0] + '@s.whatsapp.net' : '';
      const botOwnJid = sock?.user?.id ? getBareJid(sock.user.id) : '';
      const senderId = msg.key?.participant || (isFromMe ? botOwnJid : msg.key?.remoteJid) || '';

      if (msg.key?.id && sentMessageIds.has(msg.key.id)) continue;

      const isFromAdminGroup = adminGroupJid && remoteJid === adminGroupJid;
      const isDM = remoteJid.endsWith('@s.whatsapp.net');

      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        ''
      ).trim();

      if (!isDM && !isFromAdminGroup) continue;

      const { authorizedPhones, authorizedLids } = await loadAuthorizedIdentifiers();
      // fromMe = message was sent FROM this device/linked device → always admin
      const isSenderOwnNumber = isFromMe || (botOwnJid && getBareJid(senderId) === botOwnJid);
      const isSenderAdmin = isSenderOwnNumber || isSenderAuthorized(senderId, authorizedPhones, authorizedLids);

      if (!isSenderAdmin && !isFromAdminGroup) continue;

      const isImage = !!(msg.message?.imageMessage);
      const isSticker = !!(msg.message?.stickerMessage);
      const isAudio = !!(msg.message?.audioMessage);
      const isDocument = !!(msg.message?.documentMessage);
      const isVideo = !!(msg.message?.videoMessage);
      const isUnsupportedMedia = isSticker || isAudio || isDocument || isVideo;

      let session = adminUploadSessions.get(senderId);

      if (isUnsupportedMedia && session) {
        const mediaType = isSticker ? 'sticker' : isAudio ? 'voice note' : isDocument ? 'document' : 'video';
        await sendSafeMessage(
          remoteJid,
          `⚠️ I can't use a *${mediaType}* as a product image. Please send regular *photos* only! 📸`
        );
        continue;
      }

      const SESSION_TTL_MS = 30 * 60 * 1000;
      if (session && session.createdAt && (Date.now() - session.createdAt) > SESSION_TTL_MS) {
        console.warn(`⏰ [WA-ADMIN]: Session for ${senderId} expired (>30 min). Cleaning up.`);
        for (const imgPath of (session.data?.imagePaths || [])) {
          try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
        }
        adminUploadSessions.delete(senderId);
        session = null;
        await sendSafeMessage(
          remoteJid,
          "⏰ Your previous product session expired (inactive for over 30 minutes) and was cleared.\n\nSend your product details again to start a new one!"
        );
      }

      const helpCommands = ['!help', '/help', 'help'];
      if (helpCommands.includes(text.toLowerCase())) {
        const helpMessage =
          `🛠️ *Seekon Admin WhatsApp Assistant* 🛠️\n\n` +
          `You can upload new products using natural language — no rigid commands or strict punctuation!\n\n` +
          `*Example:*\n` +
          `💬 _"add a product nike dunk low price 5000 colour red with size 35 to 50"_\n\n` +
          `*How it works:*\n` +
          `1️⃣ Send a product description with any details you have (name, price, sizes, colors).\n` +
          `2️⃣ The AI analyzes your message, saves what's there, and asks for anything missing.\n` +
          `3️⃣ Once all details are confirmed, send product photos and specify if you want AI background removal (yes/no).\n` +
          `4️⃣ Reply *done* to publish the product to the store!\n\n` +
          `*Quick Controls:*\n` +
          `👉 *cancel* / *stop* / *abort* — Cancel the current session\n` +
          `👉 *help* — Show this guide\n\n` +
          `_Sessions auto-expire after 30 minutes of inactivity._`;
        await sendSafeMessage(remoteJid, helpMessage);
        continue;
      }

      if (!text && !isImage && !isUnsupportedMedia) {
        console.log(`📭 [WA-ADMIN]: Empty message from ${senderId} — skipping.`);
        continue;
      }

      const isCancelIntent =
        /\b(?:cancel|cancell?|cancle|abort|stop|quit|exit|nevermind|never mind|nvm|forget it|end this|stop this)\b/i.test(text) &&
        text.split(/\s+/).length <= 4;

      if (session && isCancelIntent) {
        for (const imgPath of (session.data?.imagePaths || [])) {
          try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
        }
        adminUploadSessions.delete(senderId);
        await sendSafeMessage(
          remoteJid,
          "❌ Product upload session cancelled. Temporary files cleaned up.\n\nSend your product details whenever you're ready to start again!"
        );
        continue;
      }

      if (!session) {
        // Ultra-lenient start trigger.
        // If it's a DM, ANY message from an admin starts/continues the conversational flow.
        // In groups, we look for intent words or product attribute combos to avoid false positives.
        const isStartTrigger =
          isDM ||
          /^(?:!|\/)?(?:add|upload|create|new|post)\b/i.test(text) ||
          (/(?:price|kes|ksh|bob|\d+k)\b/i.test(text) && /(?:size|sizes|colour|color)\b/i.test(text));

        if (!isStartTrigger) continue;

        session = {
          createdAt: Date.now(),
          data: {
            name: '',
            price: 0,
            sizes: [],
            colors: [],
            stock: 200,
            brand: 'SEEKON',
            category: 'Sneakers',
            description: '',
            runBgRemoval: false,
            imagePaths: [],
            allDetailsCollected: false
          },
          history: []
        };
        adminUploadSessions.set(senderId, session);
        console.log(`📦 [WA-ADMIN]: Initialized new product upload session for ${senderId}`);
      } else {
        const isStartTrigger =
          /^(?:!|\/)?(?:add|upload|create|new|post)\b/i.test(text) ||
          (isDM && !session.data.name && text.split(/\s+/).length < 5); // Empty session restart heuristc

        if (isStartTrigger && session.data.allDetailsCollected === false && !session.data.name) {
        } else if (isStartTrigger) {
          await sendSafeMessage(
            remoteJid,
            `⚠️ You already have an active product session for *${session.data.name || 'an unnamed product'}*.\n\n` +
            `Reply *cancel* to discard it and start fresh, or continue filling in the details!`
          );
          continue;
        }
      }

      if (isImage) {
        let downloadSuccess = false;
        try {
          await sendSafeMessage(remoteJid, "📥 Downloading image...");
          const imageMessage = msg.message.imageMessage;

          const downloadWithTimeout = new Promise(async (resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error('Image download timed out after 30s')), 30000);
            try {
              const stream = await downloadContentFromMessage(imageMessage, 'image');
              let buffer = Buffer.from([]);
              for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
              }
              clearTimeout(timeoutId);
              resolve(buffer);
            } catch (e) {
              clearTimeout(timeoutId);
              reject(e);
            }
          });

          const buffer = await downloadWithTimeout;

          if (!buffer || buffer.length === 0) {
            await sendSafeMessage(
              remoteJid,
              "⚠️ The image arrived but appears to be empty (0 bytes). Please try sending it again, preferably from your camera roll."
            );
          } else {
            const queueDir = path.join(process.cwd(), 'uploads', 'queue');
            if (!fs.existsSync(queueDir)) {
              fs.mkdirSync(queueDir, { recursive: true });
            }
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const tempFilePath = path.join(queueDir, `${uniqueSuffix}.jpg`);
            fs.writeFileSync(tempFilePath, buffer);
            session.data.imagePaths.push(tempFilePath);
            downloadSuccess = true;
            console.log(`📸 [WA-ADMIN]: Image #${session.data.imagePaths.length} stored at ${tempFilePath} (${buffer.length} bytes)`);
          }
        } catch (imgErr) {
          console.error("❌ [WA-ADMIN]: Error downloading image:", imgErr.message);
          const isTimeout = imgErr.message?.includes('timed out');
          await sendSafeMessage(
            remoteJid,
            isTimeout
              ? "⏱️ Image download timed out. WhatsApp may be slow right now — please try sending the photo again."
              : `❌ Failed to receive image: ${imgErr.message}. Please try again.`
          );
        }

        if (!text) {
          const count = session.data.imagePaths.length;
          if (session.data.allDetailsCollected) {
            const bgText = session.data.runBgRemoval ? 'Enabled ✅' : 'Disabled ❌';
            await sendSafeMessage(
              remoteJid,
              `📸 Photo #${count} received! Send more photos if needed, or reply *done* to publish.\n(AI Background Removal is currently ${bgText})`
            );
          } else {
            const missing = [];
            if (!session.data.name) missing.push('Product Name');
            if (!session.data.price) missing.push('Price');
            if (!session.data.sizes?.length) missing.push('Sizes');
            if (!session.data.colors?.length) missing.push('Colors');
            const photoLine = downloadSuccess ? `📸 Photo #${count} received!\n\n` : '';
            await sendSafeMessage(
              remoteJid,
              `${photoLine}We still need a few product details: *${missing.join(', ')}*.\nJust reply naturally with the missing info!`
            );
          }
          continue;
        }
      }

      if (!text && !isImage) continue;

      const isDoneCommand = /^(?:done|finish|finished|publish|upload|proceed|go|submit|send it)$/i.test(text);
      if (isDoneCommand) {
        if (!session.data.allDetailsCollected) {
          const missing = [];
          if (!session.data.name) missing.push('Product Name');
          if (!session.data.price) missing.push('Price');
          if (!session.data.sizes?.length) missing.push('Sizes');
          if (!session.data.colors?.length) missing.push('Colors');
          await sendSafeMessage(
            remoteJid,
            `⚠️ Not ready to publish yet — still missing: *${missing.join(', ')}*.\n\nPlease provide those first, then reply *done*!`
          );
          continue;
        }

        if (session.data.imagePaths.length === 0) {
          await sendSafeMessage(
            remoteJid,
            "📸 Please send at least one product photo first! Once uploaded, reply *done* to publish."
          );
          continue;
        }

        await finalizeAndPublishProduct(remoteJid, senderId, session);
        continue;
      }

      const existingBrands = await getExistingBrands();
      let aiResult = null;
      try {
        aiResult = await processProductConversationWithAI({
          userMessage: text,
          currentData: session.data,
          conversationHistory: session.history,
          existingBrands
        });
      } catch (groqErr) {
        console.error("❌ [WA-ADMIN]: Groq call threw unexpectedly:", groqErr.message);
        await sendSafeMessage(
          remoteJid,
          "⚠️ The AI had a hiccup processing that. Please try sending your message again!"
        );
        continue;
      }

      if (!aiResult) {
        await sendSafeMessage(
          remoteJid,
          "⚠️ AI service is temporarily unavailable. Your session is still open — please try again in a moment, or send *help*."
        );
        continue;
      }

      if (aiResult.isCancel) {
        for (const imgPath of (session.data?.imagePaths || [])) {
          try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
        }
        adminUploadSessions.delete(senderId);
        await sendSafeMessage(remoteJid, "❌ Product upload session cancelled. All temporary files deleted.");
        continue;
      }

      if (aiResult.name) {
        session.data.name = aiResult.name.trim().substring(0, 120);
      }
      if (aiResult.price) {
        const cleanedPrice = cleanPrice(aiResult.price);
        if (cleanedPrice) session.data.price = cleanedPrice;
      }
      if (aiResult.sizes && aiResult.sizes.length > 0) {
        const expanded = expandSizeRange(aiResult.sizes);
        if (expanded.length > 0) session.data.sizes = expanded;
      }
      if (aiResult.colors && aiResult.colors.length > 0) {
        const colorsArr = (Array.isArray(aiResult.colors) ? aiResult.colors : [aiResult.colors])
          .map(c => String(c).trim().substring(0, 50))
          .filter(Boolean);
        if (colorsArr.length > 0) session.data.colors = colorsArr;
      }
      if (typeof aiResult.stock === 'number' && aiResult.stock >= 0) {
        session.data.stock = aiResult.stock;
      }
      if (aiResult.brand) session.data.brand = aiResult.brand.trim().toUpperCase().substring(0, 60);
      const validCategories = ['Sneakers', 'Apparel', 'Accessories'];
      if (aiResult.category && validCategories.includes(aiResult.category.trim())) {
        session.data.category = aiResult.category.trim();
      }
      if (aiResult.description) session.data.description = aiResult.description.trim().substring(0, 1200);
      if (typeof aiResult.runBgRemoval === 'boolean') {
        session.data.runBgRemoval = aiResult.runBgRemoval;
      }

      const hasName = Boolean(session.data.name);
      const hasPrice = Boolean(session.data.price && session.data.price > 0);
      const hasSizes = Boolean(session.data.sizes && session.data.sizes.length > 0);
      const hasColors = Boolean(session.data.colors && session.data.colors.length > 0);
      session.data.allDetailsCollected = hasName && hasPrice && hasSizes && hasColors;

      if (aiResult.isDone) {
        if (session.data.allDetailsCollected && session.data.imagePaths.length > 0) {
          await finalizeAndPublishProduct(remoteJid, senderId, session);
          continue;
        } else if (!session.data.allDetailsCollected) {
        } else if (session.data.imagePaths.length === 0) {
          await sendSafeMessage(
            remoteJid,
            "📸 Almost there! Please send the product photo(s) first, then reply *done* to publish."
          );
          continue;
        }
      }

      let replyToSend = aiResult.naturalReply || "Got it! Please continue or send photos!";
      if (isImage && session.data.imagePaths.length > 0) {
        replyToSend = `📸 Photo #${session.data.imagePaths.length} received!\n\n` + replyToSend;
      }

      session.history.push({ role: 'user', content: text });
      session.history.push({ role: 'assistant', content: replyToSend });
      if (session.history.length > 8) {
        session.history = session.history.slice(-8);
      }

      await sendSafeMessage(remoteJid, replyToSend);

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

  // STEP 2.1 — MongoDB auth state (QR scan credentials persisted to DB)
  const { state, saveCreds } = await useMongoDBAuthState();

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
        if (statusCode === DisconnectReason.loggedOut) {
          console.error('❌ [WA]: Device logged out. Clearing MongoDB auth data.');
          await clearAuthData();
          isShuttingDown = true;
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

  // ── Ghost Mode — silent product extractor from buyer showcase group ───────
  // Strictly read-only for BUYER_GROUP_JID. All notifications → ADMIN_GROUP_JID.
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;
    await handleBuyerGroupGhostMode(msgs);
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
    await clearAuthData();
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
