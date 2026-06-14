import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { sendAdminOfflineAlertEmail } from '../utils/email.js';
import fs from 'fs';

let currentQR = null;
let isConnected = false;
let client = null;

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
  // Auto-detect if a Railway Persistent Volume is mounted at /data
  if (fs.existsSync('/data')) {
    console.log('📂 Railway Persistent Volume detected at /data. Storing session persistently.');
    return '/data/whatsapp-session';
  }
  return './whatsapp-session';
};

export const initWhatsAppClient = async () => {
  if (client) {
    try {
      console.log('🔄 Destroying existing WhatsApp Client instance...');
      await client.destroy();
    } catch (e) {
      console.warn('⚠️ Error destroying existing WhatsApp Client:', e.message);
    }
  }

  currentQR = null;
  isConnected = false;

  const puppeteerConfig = {
    headless: true,
    protocolTimeout: 300000, // 5 minutes (prevents protocol timeout crashes during high CPU load/syncing)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio', // Mutes audio process entirely to save media resources
      '--disable-webrtc', // Disables WebRTC to block voice/video call loads
      '--disable-3d-apis', // Disables WebGL/3D processing
      '--disable-speech-api', // Disables Speech Synthesis/Recognition APIs
      '--disk-cache-size=10485760', // Limit disk cache to 10MB
      '--media-cache-size=10485760', // Limit media cache to 10MB
      '--js-flags="--max-old-space-size=256"', // Strict 256MB JS heap limit
      '--blink-settings=imagesEnabled=false'
    ]
  };

  const executablePath = getExecutablePath();
  if (executablePath) {
    puppeteerConfig.executablePath = executablePath;
    console.log(`🔍 Forcing Puppeteer executablePath to: ${executablePath}`);
  }

  console.log('📦 Initializing WhatsApp Client with aggressive Chromium throttling...');
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: getSessionDataPath()
    }),
    puppeteer: puppeteerConfig,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
  });

  client.on('qr', (qr) => {
    currentQR = qr;
    isConnected = false;
    console.log('📍 WhatsApp QR Code Received. Scan it to authenticate:');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    console.log('✅ WhatsApp Client Authenticated successfully!');
  });

  client.on('auth_failure', (msg) => {
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
    try {
      await sendAdminOfflineAlertEmail();
      console.log('📧 Admin offline alert email sent successfully.');
    } catch (err) {
      console.error('⚠️ Failed to send admin offline alert email:', err.message);
    }
  });

  await client.initialize();
};

// Start the client initially
initWhatsAppClient().catch(err => {
  console.error('❌ Failed to initialize WhatsApp Client:', err.message);
});

// A wrapper object to delegate all properties/methods to the active client instance
const whatsappClient = {
  isRegisteredUser(...args) {
    if (!client) throw new Error('WhatsApp Client not initialized');
    return client.isRegisteredUser(...args);
  },
  getChatById(...args) {
    if (!client) throw new Error('WhatsApp Client not initialized');
    return client.getChatById(...args);
  },
  getChats(...args) {
    if (!client) throw new Error('WhatsApp Client not initialized');
    return client.getChats(...args);
  },
  sendMessage(...args) {
    if (!client) throw new Error('WhatsApp Client not initialized');
    return client.sendMessage(...args);
  }
};

// Helper to get Admin Group Chat or fallback
export const getAdminChat = async (clientInstance) => {
  const activeClient = client;
  if (!activeClient) return null;
  
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

// Safe human-mimicking messaging engine utility
export const sendSafeMessage = async (clientInstance, phone, message) => {
  const activeClient = client;
  if (!activeClient) throw new Error('WhatsApp Client not initialized');
  
  const targetPhone = '0791359930';
  let finalMessage = message;
  
  if (phone && phone !== targetPhone) {
    finalMessage = `${message}\n\n[Original Recipient: ${phone}]`;
  }
  
  try {
    // Format phone to JID
    let formatted = targetPhone.replace(/\D/g, '');
    if (formatted.startsWith('0')) {
      formatted = '254' + formatted.substring(1);
    } else if (!formatted.startsWith('254') && formatted.length === 9) {
      formatted = '254' + formatted;
    }
    
    const chatId = `${formatted}@c.us`;
    console.log(`📱 Routing message to: ${chatId} (Redirected from ${phone})`);
    
    let chat = null;
    try {
      chat = await activeClient.getChatById(chatId);
    } catch (e) {
      console.warn(`⚠️ Could not fetch chat object for JID ${chatId}:`, e.message);
    }

    if (chat) {
      try {
        // Simulate typing
        await chat.sendStateTyping();
        
        // Randomized pause (3 to 6 seconds for better responsiveness)
        const delayMs = Math.floor(Math.random() * (6000 - 3000 + 1)) + 3000;
        console.log(`⏳ Waiting for ${delayMs}ms to mimic human typing...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (typingErr) {
        console.warn('⚠️ Failed to simulate typing state:', typingErr.message);
      }
    }
    
    // Send message directly to JID - works for all contacts regardless of chat history
    const response = await activeClient.sendMessage(chatId, finalMessage);
    console.log(`✅ Message delivered successfully to override target ${targetPhone} (Original: ${phone})`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to send safe message to override target ${targetPhone} (Original: ${phone}):`, error.message);
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
