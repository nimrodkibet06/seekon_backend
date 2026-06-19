import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { sendAdminOfflineAlertEmail } from '../utils/email.js';
import fs from 'fs';

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
      '--disable-webrtc',
      '--disable-3d-apis',
      '--disable-speech-api',
      '--disable-canvas-path-rendering',
      '--js-flags="--max-old-space-size=512"',
      '--disk-cache-size=10485760',
      '--media-cache-size=10485760',
      '--blink-settings=imagesEnabled=false'
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

  client.on('ready', () => {
    currentQR = null;
    isConnected = true;
    console.log('🚀 WhatsApp Client is READY and ONLINE confirmation logged!');
  });

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

startWithRetry();

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

export const getStatus = () => {
  return {
    connected: isConnected,
    qr: currentQR
  };
};

export default whatsappClient;
