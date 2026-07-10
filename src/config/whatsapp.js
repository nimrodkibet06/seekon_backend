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
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import sharp from 'sharp';
import { v2 as cloudinaryV2 } from 'cloudinary';

// Internal imports — same as before, no breaking changes to consumers
import {
  sendAdminOfflineAlertEmail,
  sendSuccessNotificationEmail,
  getResendClient,
} from '../utils/email.js';
import FlashStatus from '../models/FlashStatus.js';
import Setting from '../models/Setting.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';

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
        let clean = String(num).trim().replace(/\D/g, '');
        if (clean.startsWith('0') && clean.length === 10) clean = '254' + clean.slice(1);
        if (clean) rawPhones.push(clean);
      });
    }
  } catch (e) {
    console.error('⚠️ [WA-AUTH]: DB phone fetch failed:', e.message);
  }

  // Env-var fallback phones
  if (process.env.AUTHORIZED_ADMIN_PHONES) {
    process.env.AUTHORIZED_ADMIN_PHONES.split(',')
      .map(n => n.trim().replace(/\D/g, ''))
      .filter(Boolean)
      .forEach(n => {
        let clean = n;
        if (clean.startsWith('0') && clean.length === 10) clean = '254' + clean.slice(1);
        rawPhones.push(clean);
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
// STEP 4 + 5 — handleStatusUpsert: core messages.upsert handler
// ─────────────────────────────────────────────────────────────────────────────
const recentlyProcessed = new Set();

const handleStatusUpsert = async (messages) => {
  for (const msg of messages) {
    try {
      // STEP 4.1 — Only process messages from the 'status@broadcast' remoteJid
      if (msg.key?.remoteJid !== 'status@broadcast') continue;

      // Sender resolution: group participant takes priority over remoteJid
      const senderId = msg.key?.participant || msg.key?.remoteJid;

      // Dedup fingerprint — prevents double-processing the same status event
      const msgKey = `${senderId}_${msg.messageTimestamp || Date.now()}`;
      if (recentlyProcessed.has(msgKey)) continue;
      recentlyProcessed.add(msgKey);
      setTimeout(() => recentlyProcessed.delete(msgKey), 15000);

      console.log(`📱 [WA-STATUS]: Incoming status broadcast from ${senderId}`);

      // STEP 3.1 — Load whitelist from MongoDB cache (no real-time lookups)
      const { authorizedPhones, authorizedLids } = await loadAuthorizedIdentifiers();
      console.log(`📱 [WA-STATUS]: Whitelist → phones: [${authorizedPhones.join(', ')}] | LIDs: [${authorizedLids.join(', ')}]`);

      // STEP 3.2 & 3.3 — Authorize sender; handle @lid with clean string match
      if (!isSenderAuthorized(senderId, authorizedPhones, authorizedLids)) {
        // STEP 5.3 — Unauthorized viewer → trigger First-Time Lead Captured flow
        await handleLeadCapture(senderId);
        continue;
      }

      console.log(`✅ [WA-STATUS]: ${senderId} authorized. Processing...`);

      // Escape hatch: caption containing '.' signals an intentional skip
      const caption =
        msg.message?.imageMessage?.caption  ||
        msg.message?.videoMessage?.caption  ||
        msg.message?.extendedTextMessage?.text || '';

      if (caption.includes('.')) {
        console.log('🤫 [WA-STATUS]: Escape hatch triggered (caption contains "."). Skipping.');
        continue;
      }

      // STEP 2 — Pseudo-Gaussian anti-ban jitter delay before any action
      await humanDelay(1500, 5000);

      // STEP 4 — Download + STEP 5.1 — upload to Status Cloudinary (Account B)
      const mediaResult = await processStatusMedia(msg);
      if (!mediaResult) continue; // no media or graceful failure — skip

      const { uploadResult, mediaType } = mediaResult;

      // STEP 5.2 — Persist to MongoDB using the existing FlashStatus schema
      const flashStatus = new FlashStatus({
        mediaUrl:           uploadResult.secure_url,
        mediaType,
        caption,
        author:             senderId,
        cloudinaryPublicId: uploadResult.public_id,
        createdAt:          new Date(),
      });
      await flashStatus.save();
      console.log(`💾 [WA-STATUS]: Saved to MongoDB: ID ${flashStatus._id}`);

      // STEP 5.2 — Route finalized URL + metadata through customer lead pipeline
      sendSuccessNotificationEmail('nimrodkibet376@gmail.com', {
        author:    senderId,
        type:      mediaType,
        mediaUrl:  uploadResult.secure_url,
        timestamp: flashStatus.createdAt,
      }).catch(e =>
        console.error('⚠️ [WA-STATUS]: Success notification email failed (non-fatal):', e.message)
      );

    } catch (err) {
      // STEP 4.3 — Top-level boundary: a single status failure must never crash the process
      console.error('🔥 [WA-STATUS INTERCEPT ERROR]:', err.message || err);
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
    printQRInTerminal: true,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // STEP 2.2 — Hidden browser string masks automation indicators
    browser: ['Seekon Desktop', 'Chrome', '10.0.0'],
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

  // ── STEP 4.1 — Status broadcast interception via messages.upsert ─────────
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return; // 'notify' = new real-time messages only
    await handleStatusUpsert(msgs);
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
  let formatted = String(phone).replace(/\D/g, '');
  if (formatted.startsWith('0') && formatted.length === 10) {
    formatted = '254' + formatted.substring(1);
  } else if (!formatted.startsWith('254') && formatted.length === 9) {
    formatted = '254' + formatted;
  }
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

  try {
    let chatId;
    if (phone === 'me' || phone === 'self') {
      const ownJid = sock.user?.id;
      if (!ownJid) throw new Error('Bot JID not yet loaded — cannot message self.');
      chatId = ownJid;
    } else {
      chatId = formatPhoneToJid(phone);
    }

    console.log(`📱 [WA-SEND]: Routing to ${chatId} (Attempt ${attempt}/3)`);

    // STEP 2 — Human-like jitter + composing presence before every send
    await humanDelay(1500, 5000);
    await simulateTyping(chatId, message);

    const withTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      ),
    ]);

    const result = await withTimeout(
      sock.sendMessage(chatId, { text: message }),
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
