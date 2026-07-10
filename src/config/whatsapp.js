import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { sendAdminOfflineAlertEmail, sendSuccessNotificationEmail } from '../utils/email.js';
import fs from 'fs';
import sharp from 'sharp';
import cloudinary from './cloudinary.js';
import FlashStatus from '../models/FlashStatus.js';
import Setting from '../models/Setting.js';


let currentQR = null;
let isConnected = false;
let client = null;
let isShuttingDown = false;

const getExecutablePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (fs.existsSync('/usr/bin/chromium')) {
    return '/usr/bin/chromium';
  }
  if (fs.existsSync('/usr/bin/chromium-browser')) {
    return '/usr/bin/chromium-browser';
  }
  return undefined;
};

const getSessionDataPath = () => {
  // Priority: env var > /data volume > local fallback
  if (process.env.WHATSAPP_SESSION_PATH) {
    console.log(`📂 Using WHATSAPP_SESSION_PATH from env: ${process.env.WHATSAPP_SESSION_PATH}`);
    return process.env.WHATSAPP_SESSION_PATH;
  }
  // Auto-detect Railway Persistent Volume at /data
  if (fs.existsSync('/data')) {
    const volumePath = '/data/whatsapp-session';
    console.log(`📂 Railway Persistent Volume detected. Using: ${volumePath}`);
    return volumePath;
  }
  return './whatsapp-session';
};

/**
 * Safely clean up session directory before init to prevent EBUSY lockfile crashes.
 */
const prepareSessionDir = (basePath) => {
  try {
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
      console.log(`📂 Created WhatsApp session directory at ${basePath}`);
    }
    // Remove stale lockfile if present (prevents EBUSY on shutdown/startup)
    const lockFile = `${basePath}/session/lockfile`;
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      console.log('🗑️ Removed stale WhatsApp lockfile');
    }
  } catch (e) {
    console.warn('⚠️ Unable to prepare WhatsApp session directory:', e.message);
  }
};

/**
 * Safely destroy the client, swallowing EBUSY and other shutdown errors.
 */
const safeDestroy = async () => {
  if (!client) return;
  try {
    await client.destroy();
  } catch (e) {
    // EBUSY lockfile errors during destroy are expected on Windows/cloud — swallow them
    if (e.message?.includes('EBUSY') || e.message?.includes('lockfile')) {
      console.warn('⚠️ Ignored EBUSY lockfile error during client destroy (expected on cloud).');
    } else {
      console.warn('⚠️ Error destroying WhatsApp Client:', e.message);
    }
  }
  client = null;
};

export const initWhatsAppClient = async () => {
  if (client) {
    console.log('🔄 Destroying existing WhatsApp Client instance...');
    await safeDestroy();
  }

  currentQR = null;
  isConnected = false;

  const sessionPath = getSessionDataPath();
  prepareSessionDir(sessionPath);

  const puppeteerConfig = {
    headless: true,
    protocolTimeout: 300000, // 5 minutes
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--disable-software-rasterizer',
      '--single-process',
      '--disable-features=site-per-process',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio',
      '--disable-audio-output',
      '--disable-remote-fonts',
      '--disable-webrtc',
      '--disable-3d-apis',
      '--disable-speech-api',
      '--disable-canvas-path-rendering',
      '--js-flags="--max-old-space-size=120 --expose-gc"',
      '--disk-cache-size=10485760',
      '--media-cache-size=10485760',
      '--blink-settings=imagesEnabled=false',
      '--disable-renderer-accessibility',
      '--disable-dev-profile',
      '--disable-ipc-flooding-protection',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-notifications',
      '--disable-logging',
      '--disable-print-preview',
      '--disable-speech',
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
      '--use-mock-keychain'
    ]
  };

  const executablePath = getExecutablePath();
  if (executablePath) {
    puppeteerConfig.executablePath = executablePath;
    console.log(`🔍 Forcing Puppeteer executablePath to: ${executablePath}`);
  }

  console.log(`📦 Initializing WhatsApp Client (session: ${sessionPath})...`);
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: sessionPath
    }),
    puppeteer: puppeteerConfig,
    webVersion: '2.3000.1041716477-alpha',
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  client.on('qr', (qr) => {
    currentQR = qr;
    isConnected = false;
    console.log('📍 WhatsApp QR Code Received. Scan it to authenticate:');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    currentQR = null; // CRITICAL: Clear QR so frontend stops showing it
    console.log('✅ WhatsApp Client Authenticated successfully!');
  });

  client.on('auth_failure', (msg) => {
    currentQR = null;
    console.error('❌ WhatsApp Authentication Failure:', msg);
  });

  client.on('ready', async () => {
    currentQR = null;
    isConnected = true;
    console.log('🚀 WhatsApp Client is READY and ONLINE confirmation logged!');
    
    // Intercept Puppeteer requests to block media, image, and font downloads to save bandwidth/RAM
    try {
      const page = client.pupPage;
      if (page) {
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          try {
            if (request.isInterceptResolutionHandled()) return;
            
            const resourceType = request.resourceType();
            if (['image', 'media', 'font'].includes(resourceType)) {
              request.abort().catch(() => {});
            } else {
              request.continue().catch(() => {});
            }
          } catch (err) {
            // Suppress errors if request is already handled or resolved
          }
        });
        console.log('🛡️ Puppeteer request interception active: Blocked images, media, and fonts.');
      }
    } catch (e) {
      console.warn('⚠️ Request interception setup skipped/failed:', e.message);
    }

    // Periodically trigger page-level garbage collection in Chrome to free leaked WhatsApp Web RAM
    setInterval(async () => {
      try {
        const page = client?.pupPage;
        if (page && isConnected) {
          await page.evaluate(() => {
            if (typeof window.gc === 'function') {
              window.gc();
            }
          });
          console.log('🧹 [PUPPETEER]: Forced garbage collection inside Chromium page.');
        }
      } catch (gcErr) {
        // Suppress errors if page is not active
      }
    }, 1800000); // Every 30 minutes
  });

  // ─────────────────────────────────────────────────────────────────
  // Shared handler for incoming AND outgoing status updates.
  // 'message'        → statuses posted by OTHER people (including the
  //                    account owner posting from their own phone).
  // 'message_create' → messages/statuses posted BY the bot itself
  //                    (used for the automated self-test trigger).
  // ─────────────────────────────────────────────────────────────────
  // Dedup set: prevents double-processing when both events fire for
  // the same status (message fires once, message_create fires once).
  const recentlyProcessed = new Set();

  const handleStatusUpdate = async (msg) => {
    try {
      // 1. Only process status broadcast messages
      if (msg.from !== 'status@broadcast') {
        return;
      }

      // Dedup: build a fingerprint from author + timestamp
      const msgKey = `${msg.author || msg.from}_${msg.timestamp || Date.now()}`;
      if (recentlyProcessed.has(msgKey)) {
        return; // already being handled by the other event
      }
      recentlyProcessed.add(msgKey);
      // Auto-expire dedup key after 10 seconds
      setTimeout(() => recentlyProcessed.delete(msgKey), 10000);

      console.log(`📱 [WHATSAPP STATUS INTERCEPTED]: New status update from ${msg.author || msg.from}`);

      // 2. Load authorized phone numbers from DB
      const rawAuthorizedPhones = [];

      try {
        const dbSetting = await Setting.findOne({ key: 'authorized_status_phones' });
        if (dbSetting && dbSetting.value && Array.isArray(dbSetting.value.phones)) {
          dbSetting.value.phones.forEach(num => {
            let cleanNum = String(num).trim().replace(/\D/g, '');
            // Normalize Kenyan local format 07xx → 2547xx
            if (cleanNum.startsWith('0') && cleanNum.length === 10) {
              cleanNum = '254' + cleanNum.slice(1);
            }
            if (cleanNum) rawAuthorizedPhones.push(cleanNum);
          });
        }
      } catch (dbErr) {
        console.error('⚠️ [WHATSAPP STATUS]: Failed to load dynamic admin phones from DB:', dbErr.message);
      }

      if (process.env.AUTHORIZED_ADMIN_PHONES) {
        process.env.AUTHORIZED_ADMIN_PHONES.split(',')
          .map(n => n.trim().replace(/\D/g, ''))
          .filter(Boolean)
          .forEach(n => rawAuthorizedPhones.push(n));
      }

      const author = msg.author || msg.from;

      // 3. Try to resolve the real phone number from the contact (fixes @lid issues)
      let senderPhone = '';
      try {
        const contact = await msg.getContact();
        if (contact && contact.number) {
          senderPhone = String(contact.number).replace(/\D/g, '');
        }
      } catch (err) {
        console.warn('⚠️ [WHATSAPP STATUS]: Failed to get contact details:', err.message);
      }

      // Also extract bare digits from the LID/JID itself as a fallback
      const authorDigits = author.replace(/[^0-9]/g, '');

      console.log(`📱 [WHATSAPP STATUS]: Author JID=${author} | Resolved phone=${senderPhone || '(none)'} | LID digits=${authorDigits}`);

      // 4. Check if this is the bot's own account (self-post auto-authorized)
      const isSelf = client.info && client.info.wid &&
        (author === client.info.wid._serialized ||
         author.includes(client.info.wid.user) ||
         (senderPhone && senderPhone === String(client.info.wid.user).replace(/\D/g, '')));

      if (isSelf) {
        console.log(`✅ [WHATSAPP STATUS]: Author is the bot's own account (${author}). Auto-authorizing!`);
      }

      // 5. Match against stored authorized phones using multiple strategies:
      //    a) Exact match on resolved phone
      //    b) Suffix match — last N digits (handles country-code variations)
      //    c) Suffix match on LID digits (resolves LID ↔ real-number mapping)
      const SUFFIX_LEN = 9; // last 9 digits are typically unique per subscriber
      const senderSuffix = (senderPhone || authorDigits).slice(-SUFFIX_LEN);

      const isAuthorized = isSelf || rawAuthorizedPhones.some(adminPhone => {
        if (!adminPhone) return false;
        const adminSuffix = adminPhone.slice(-SUFFIX_LEN);
        return (
          senderPhone === adminPhone ||
          authorDigits === adminPhone ||
          senderSuffix === adminSuffix ||
          author.includes(adminPhone)
        );
      });

      if (!isAuthorized) {
        console.log(`❌ [WHATSAPP STATUS]: Author ${author} (Phone: ${senderPhone}, Suffix: ${senderSuffix}) is not an authorized admin. Skipping.`);
        return;
      }

      // 3. Escape hatch: If body contains predefined ignore character (e.g. '.'), skip.
      if (msg.body && msg.body.includes('.')) {
        console.log('🤫 [WHATSAPP STATUS]: Escape hatch triggered (body contains "."). Skipping.');
        return;
      }

      // 4. Bottleneck mitigation: human-like delay before bot interaction/processing
      const delayMs = Math.floor(Math.random() * 2000) + 2000; // 2000ms - 4000ms delay
      console.log(`⏳ [WHATSAPP STATUS]: Waiting for ${delayMs}ms (human-like reading delay)...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));

      // 5. Download media
      if (!msg.hasMedia) {
        console.log('⚠️ [WHATSAPP STATUS]: Status message has no media. Skipping.');
        return;
      }

      console.log('📥 [WHATSAPP STATUS]: Downloading media...');
      const media = await msg.downloadMedia();
      if (!media || !media.data) {
        console.error('❌ [WHATSAPP STATUS]: Failed to download media content.');
        return;
      }

      const buffer = Buffer.from(media.data, 'base64');
      const mimeType = media.mimetype || '';
      
      let mediaType = 'image';
      if (mimeType.startsWith('video/')) {
        mediaType = 'video';
      }

      console.log(`⚙️ [WHATSAPP STATUS]: Processing ${mediaType} (${mimeType}), original size: ${buffer.length} bytes`);

      let uploadResult;
      
      if (mediaType === 'image') {
        // Image Sub-pipeline: Pass buffers through Sharp.
        // Execute .rotate() to fix mobile orientation metadata,
        // strip embedded tracking profiles via .withMetadata(false),
        // resize down to a max width of 1080px,
        // convert to WebP targeting compressed file size.
        const processedBuffer = await sharp(buffer)
          .rotate()
          .resize({ width: 1080, withoutEnlargement: true })
          .webp({ quality: 50 }) // highly compressed
          .withMetadata(false)
          .toBuffer();

        console.log(`⚙️ [WHATSAPP STATUS]: Image optimized. New size: ${processedBuffer.length} bytes. Uploading...`);

        uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'seekon-status',
              resource_type: 'image',
              fetch_format: 'webp',
              quality: 'auto'
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(processedBuffer);
        });

      } else if (mediaType === 'video') {
        // Video Sub-pipeline: Stream video buffers straight to Cloudinary using eager transformation parameters:
        // duration: "15.0", width: 480, crop: "limit", quality: "auto", fetch_format: "mp4".
        // Use eager_async: true to prevent blocking the single-threaded Node event loop.
        console.log('⚙️ [WHATSAPP STATUS]: Streaming video to Cloudinary with eager transformations...');
        uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'seekon-status',
              resource_type: 'video',
              eager: [
                {
                  duration: '15.0',
                  width: 480,
                  crop: 'limit',
                  quality: 'auto',
                  fetch_format: 'mp4'
                }
              ],
              eager_async: true
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(buffer);
        });
      }

      if (!uploadResult || !uploadResult.secure_url) {
        throw new Error('Cloudinary upload did not return a valid URL.');
      }

      console.log(`✅ [WHATSAPP STATUS]: Successfully uploaded media to Cloudinary: ${uploadResult.secure_url}`);

      // 6. Mongoose Persistence
      const flashStatus = new FlashStatus({
        mediaUrl: uploadResult.secure_url,
        mediaType: mediaType,
        caption: msg.body || '',
        author: author,
        cloudinaryPublicId: uploadResult.public_id,
        createdAt: new Date()
      });

      await flashStatus.save();
      console.log(`💾 [WHATSAPP STATUS]: Saved status metadata to MongoDB: ID ${flashStatus._id}`);

      // Send admin success notification email (non-blocking)
      sendSuccessNotificationEmail('nimrodkibet376@gmail.com', {
        author: author,
        type: mediaType,
        mediaUrl: uploadResult.secure_url,
        timestamp: flashStatus.createdAt
      }).catch(mailErr => {
        console.error('⚠️ Failed to send status success notification email:', mailErr.message);
      });

    } catch (err) {
      console.error('🔥 [WHATSAPP STATUS INTERCEPT ERROR]:', err);
    }
  };

  // Register the same handler on BOTH events:
  // - 'message'        catches statuses posted by others (incl. the account owner from their own phone)
  // - 'message_create' catches messages the bot itself generates (self-test trigger)
  client.on('message', handleStatusUpdate);
  client.on('message_create', handleStatusUpdate);

  client.on('disconnected', async (reason) => {
    currentQR = null;
    isConnected = false;
    console.warn('❌ WhatsApp Client Disconnected:', reason);

    // Send admin alert email (non-blocking)
    try {
      await sendAdminOfflineAlertEmail();
      console.log('📧 Admin offline alert email sent successfully.');
    } catch (err) {
      console.error('⚠️ Failed to send admin offline alert email:', err.message);
    }

    // Auto-reconnect after disconnect (unless we're shutting down the process)
    if (!isShuttingDown) {
      console.log('🔄 Auto-reconnect: Will attempt to reinitialize in 30 seconds...');
      setTimeout(() => {
        if (!isShuttingDown) {
          startWithRetry(1);
        }
      }, 30000);
    }
  });

  await client.initialize();
};

// Start the client initially with automatic retry on transient startup crashes
const startWithRetry = async (attempt = 1) => {
  try {
    await initWhatsAppClient();
  } catch (err) {
    console.error(`❌ Failed to initialize WhatsApp Client (Attempt ${attempt}/3):`, err.message || err);
    if (attempt < 3 && !isShuttingDown) {
      const delay = attempt * 15000; // 15s, 30s
      console.log(`🔄 Retrying WhatsApp client initialization in ${delay / 1000}s...`);
      setTimeout(() => startWithRetry(attempt + 1), delay);
    } else {
      console.error('❌ WhatsApp Client initialization failed after all retries. Bot will remain offline until manual restart.');
    }
  }
};

if (process.env.DISABLE_WHATSAPP !== 'true') {
  startWithRetry();
} else {
  console.log('🚫 WhatsApp client initialization disabled via DISABLE_WHATSAPP environment variable.');
}

// Graceful shutdown: prevent EBUSY crashes on Railway SIGTERM / local Ctrl+C
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}. Gracefully shutting down WhatsApp client...`);
  await safeDestroy();
  // Don't call process.exit() here — let the Node runtime finish naturally
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// A wrapper object to delegate all properties/methods to the active client instance
const whatsappClient = {
  isRegisteredUser(...args) {
    if (!client || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
    return client.isRegisteredUser(...args);
  },
  getChatById(...args) {
    if (!client || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
    return client.getChatById(...args);
  },
  getChats(...args) {
    if (!client || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
    return client.getChats(...args);
  },
  sendMessage(...args) {
    if (!client || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
    return client.sendMessage(...args);
  }
};

export const getRawClient = () => client;

// Helper to get Admin Group Chat or fallback
export const getAdminChat = async (clientInstance) => {
  const activeClient = client;
  if (!activeClient || !isConnected) return null;
  
  if (process.env.ADMIN_WHATSAPP_GROUP_ID) {
    try {
      const chat = await activeClient.getChatById(process.env.ADMIN_WHATSAPP_GROUP_ID);
      if (chat) return chat;
    } catch (e) {
      console.warn('⚠️ Could not fetch admin group by ID:', e.message);
    }
  }

  try {
    const chats = await activeClient.getChats();
    // Search for a group chat containing "admin" or "seekon" in its name
    const adminChat = chats.find(c => c.isGroup && c.name.toLowerCase().includes('admin'));
    if (adminChat) return adminChat;
  } catch (e) {
    console.warn('⚠️ Could not search chats for admin group:', e.message);
  }

  return null;
};

// Safe messaging utility with timeout protection and retry logic
export const sendSafeMessage = async (clientInstance, phone, message, attempt = 1) => {
  const activeClient = client;
  if (!activeClient || !isConnected) throw new Error('WhatsApp Client is offline or not authenticated yet.');
  
  try {
    let chatId;
    if (phone === 'me' || phone === 'self') {
      if (activeClient.info && activeClient.info.wid) {
        chatId = activeClient.info.wid._serialized;
      } else {
        throw new Error('Client info not loaded yet - cannot message self');
      }
    } else {
      let formatted = phone.replace(/\D/g, '');
      if (formatted.startsWith('0')) {
        formatted = '254' + formatted.substring(1);
      } else if (!formatted.startsWith('254') && formatted.length === 9) {
        formatted = '254' + formatted;
      }
      chatId = `${formatted}@c.us`;
    }
    
    console.log(`📱 [SEND] Routing to: ${chatId} (Attempt ${attempt}/3)`);

    // Timeout wrapper — prevents hanging forever if Chromium is unresponsive
    const withTimeout = (promise, ms, label) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
      ]);
    };
    
    // Skip typing simulation entirely — just send the message directly
    // Typing delays waste resources and can cause timeouts on Railway
    console.log(`📱 [SEND] Sending message directly (no typing delay)...`);
    
    const response = await withTimeout(
      activeClient.sendMessage(chatId, message),
      60000, // 60 second timeout
      'sendMessage'
    );
    
    console.log(`✅ [SEND] Message delivered successfully to ${chatId}`);
    return response;
  } catch (error) {
    console.error(`❌ [SEND] Failed on attempt ${attempt}: ${error.message}`);
    if (attempt < 3) {
      const waitTime = attempt * 5000; // 5s, 10s
      console.log(`🔄 [SEND] Retrying in ${waitTime / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return sendSafeMessage(clientInstance, phone, message, attempt + 1);
    }
    throw error;
  }
};

export const logoutWhatsAppClient = async () => {
  console.log('🛑 Force logout requested for WhatsApp client...');
  
  if (client) {
    try {
      if (isConnected) {
        console.log('🔄 Calling client.logout()...');
        await client.logout();
      }
    } catch (e) {
      console.warn('⚠️ Error calling client.logout():', e.message);
    }
    
    console.log('🔄 Destroying client instance...');
    await safeDestroy();
  }
  
  // Wipe session directory
  const sessionPath = getSessionDataPath();
  try {
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`🗑️ Successfully deleted session directory at: ${sessionPath}`);
    }
  } catch (err) {
    console.error('❌ Failed to delete session directory:', err.message);
  }
  
  // Reinitialize client to generate a new QR code
  console.log('🔄 Reinitializing a fresh WhatsApp client...');
  await initWhatsAppClient();
};

export const getStatus = () => {
  return {
    connected: isConnected,
    qr: currentQR
  };
};

export default whatsappClient;
