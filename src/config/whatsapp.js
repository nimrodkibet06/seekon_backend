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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
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
      dataPath: './whatsapp-session'
    }),
    puppeteer: puppeteerConfig
  });

  client.on('qr', (qr) => {
    currentQR = qr;
    isConnected = false;
    console.log('📍 WhatsApp QR Code Received. Scan it to authenticate:');
    qrcode.generate(qr, { small: true });
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
  
  try {
    // Format phone to JID
    let formatted = phone.replace(/\D/g, '');
    if (formatted.startsWith('0')) {
      formatted = '254' + formatted.substring(1);
    } else if (!formatted.startsWith('254') && formatted.length === 9) {
      formatted = '254' + formatted;
    }
    
    const chatId = `${formatted}@c.us`;
    console.log(`📱 Routing message to: ${chatId}`);
    
    const chat = await activeClient.getChatById(chatId);
    
    // Simulate typing
    await chat.sendStateTyping();
    
    // Randomized pause (5 to 10 seconds)
    const delayMs = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
    console.log(`⏳ Waiting for ${delayMs}ms to mimic human typing...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    const response = await chat.sendMessage(message);
    console.log(`✅ Message delivered successfully to ${phone}`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to send safe message to ${phone}:`, error.message);
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
