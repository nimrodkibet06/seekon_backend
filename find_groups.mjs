import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

async function getGroupJid() {
  const { state, saveCreds } = await useMultiFileAuthState('./temp_group_finder_auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr } = update;

    if (qr) {
      console.log('\n📱 QR code printed above — scan it with WhatsApp to connect.\n');
    }

    if (connection === 'open') {
      console.log('\n✅ Connected to WhatsApp!');
      console.log('🔍 Scanning for groups...\n');

      const groups = await sock.groupFetchAllParticipating();
      const keywords = ['seekon', 'buyer', 'showcase', 'admin', 'command', 'seller', 'store'];

      const allJids = Object.keys(groups);
      console.log(`Found ${allJids.length} total group(s).\n`);

      // Print all groups
      for (const jid of allJids) {
        const name = groups[jid].subject || '(no name)';
        const isKeyword = keywords.some(k => name.toLowerCase().includes(k));
        const flag = isKeyword ? '  ⭐ <-- POSSIBLE MATCH' : '';
        console.log(`  Name: "${name}"  -->  JID: ${jid}${flag}`);
      }

      console.log('\n✅ Done. Copy the JID(s) you need and press Ctrl+C to exit.');
    }

    if (connection === 'close') {
      console.log('Connection closed.');
    }
  });
}

getGroupJid().catch(console.error);
