import fs from 'fs';
import mongoose from 'mongoose';

// 🚨 PASTE YOUR NEW MONGODB URI HERE
const NEW_MONGO_URI = 'mongodb+srv://<user>:<password>@<new-cluster>.mongodb.net/test';
// 🚨 PASTE THE DOWNLOADED BACKUP FILE NAME HERE
const BACKUP_FILE = './seekon_backup_2026-05-20.json'; 

const restoreBackup = async () => {
  try {
    console.log('🔄 Connecting to new MongoDB cluster...');
    await mongoose.connect(NEW_MONGO_URI);
    console.log('✅ Connected successfully!');

    console.log(`📂 Reading backup payload from ${BACKUP_FILE}...`);
    const fileContent = fs.readFileSync(BACKUP_FILE, 'utf-8');
    const backupData = JSON.parse(fileContent);

    // Assuming your backup JSON stores the actual collection arrays under a key like "data" or "collections"
    // If your JSON just has the collections at the root, you can loop through the keys directly.
    const collectionsToRestore = backupData.data || backupData; 

    // Loop through every collection in the JSON file
    for (const [collectionName, documents] of Object.entries(collectionsToRestore)) {
      // Skip metadata keys like "timestamp" or "documentCounts"
      if (!Array.isArray(documents)) continue; 

      console.log(`[Restore] Processing collection: ${collectionName} (${documents.length} items)`);

      // Dynamically access the Mongoose connection to insert raw data
      const collection = mongoose.connection.collection(collectionName);

      // Optional: Clear the new database's collection first to prevent duplicate ID errors
      await collection.deleteMany({});

      if (documents.length > 0) {
        // Insert all documents back into the database
        await collection.insertMany(documents);
        console.log(`   ✅ ${collectionName} restored!`);
      } else {
        console.log(`   ⏩ ${collectionName} was empty, skipping.`);
      }
    }

    console.log('🎉 DISASTER RECOVERY COMPLETE! All data restored.');
    process.exit(0);

  } catch (error) {
    console.error('❌ Restore failed:', error);
    process.exit(1);
  }
};

restoreBackup();