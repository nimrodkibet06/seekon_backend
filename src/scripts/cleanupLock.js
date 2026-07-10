import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const lockPath = 'C:\\Users\\Nextgen\\Desktop\\seekon-split\\seekoon-backend\\whatsapp-session\\session\\lockfile';

const cleanup = async () => {
  try {
    console.log('🔍 Checking for stale WhatsApp session lockfile...');
    if (fs.existsSync(lockPath)) {
      console.log('Stale lockfile found. Attempting to delete...');
      fs.unlinkSync(lockPath);
      console.log('✅ Stale lockfile deleted successfully.');
    } else {
      console.log('👍 No lockfile found.');
    }
  } catch (err) {
    console.warn('⚠️ Lockfile is busy. Finding processes holding it...');
    
    // Kill orphaned chrome/chromium instances
    try {
      console.log('Stopping all running Chrome/Chromium processes to release session locks...');
      execSync('taskkill /f /im chrome.exe');
      console.log('✅ Chrome/Chromium processes killed.');
    } catch (e) {
      console.log('No Chrome processes found or already stopped.');
    }

    // Kill any other Node process executing server.js
    try {
      const output = execSync('wmic process where "name=\'node.exe\'" get processid,commandline').toString();
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('src/server.js') && !line.includes('cleanupLock.js')) {
          const match = line.trim().match(/(\d+)$/);
          if (match) {
            const pid = match[1];
            console.log(`Killing orphaned node process with PID ${pid}...`);
            execSync(`taskkill /f /pid ${pid}`);
          }
        }
      }
    } catch (e) {
      console.log('Failed to query or kill other node processes:', e.message);
    }

    // Try deleting the lockfile again
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        console.log('✅ Stale lockfile deleted after process cleanup.');
      }
    } catch (e) {
      console.error('❌ Still unable to release lockfile:', e.message);
    }
  }
};

cleanup();
