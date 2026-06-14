import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { sendAdminOfflineAlertEmail } from '../utils/email.js';

let currentQR = null;
let isConnected = false;

console.log('📦 Initializing WhatsApp Client with aggressive Chromium throttling...');

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './whatsapp-session'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--disable-gpu',
      '--blink-settings=imagesEnabled=false'
    ]
  }
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

// Helper to get Admin Group Chat or fallback
export const getAdminChat = async (clientInstance) => {
  if (process.env.ADMIN_WHATSAPP_GROUP_ID) {
    try {
      const chat = await clientInstance.getChatById(process.env.ADMIN_WHATSAPP_GROUP_ID);
      if (chat) return chat;
    } catch (e) {
      console.warn('⚠️ Could not fetch admin group by ID:', e.message);
    }
  }

  try {
    const chats = await clientInstance.getChats();
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
    
    const chat = await clientInstance.getChatById(chatId);
    
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

client.initialize().catch(err => {
  console.error('❌ Failed to initialize WhatsApp Client:', err.message);
});

export default client;
