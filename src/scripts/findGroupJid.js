import dotenv from 'dotenv';
dotenv.config();

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';

const AUTH_DIR = process.env.WHATSAPP_SESSION_PATH || './baileys_auth_info';
const logger = pino({ level: 'silent' });

async function run() {
  console.log('⚡ Starting WhatsApp client to find "Seekon command center" JID...');
  
  if (!fs.existsSync(AUTH_DIR)) {
    console.error(`❌ Error: Auth session directory "${AUTH_DIR}" does not exist.`);
    console.error(`Please make sure your main WhatsApp bot is running, authenticated, and has generated session files in: ${AUTH_DIR}`);
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('✅ Connection open! Fetching groups...');
      try {
        const groups = await sock.groupFetchAllParticipating();
        console.log(`\n📋 Found ${Object.keys(groups).length} participating groups:\n`);
        
        let found = false;
        for (const jid of Object.keys(groups)) {
          const group = groups[jid];
          console.log(`- Group Name: "${group.subject}"`);
          console.log(`  Group JID:  ${jid}\n`);
          
          if (group.subject.toLowerCase().includes('seekon command center')) {
            console.log(`🎉 MATCH FOUND!`);
            console.log(`*************************************************`);
            console.log(`Name: ${group.subject}`);
            console.log(`JID:  ${jid}`);
            console.log(`*************************************************\n`);
            found = true;
          }
        }
        
        if (!found) {
          console.log('⚠️ Could not find any group containing "Seekon command center" in the name.');
          console.log('Make sure the bot account is added to the group first.');
        }
        
      } catch (err) {
        console.error('❌ Failed to fetch groups:', err.message);
      } finally {
        console.log('🔌 Closing connection...');
        sock.end();
        process.exit(0);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (!shouldReconnect) {
        console.error('❌ Session logged out. Please start the backend and re-scan the QR code.');
        process.exit(1);
      }
    }
  });
}

run().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
