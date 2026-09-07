import mongoose from 'mongoose';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

// Define the schema for storing WhatsApp auth data
const AuthSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  data: { type: String, required: true }
}, { timestamps: true });

// Avoid model recompilation errors in hot-reloads
const AuthModel = mongoose.models.WhatsAppAuth || mongoose.model('WhatsAppAuth', AuthSchema);

export const useMongoDBAuthState = async () => {
  const readData = async (id) => {
    try {
      const doc = await AuthModel.findById(id);
      if (doc) {
        return JSON.parse(doc.data, BufferJSON.reviver);
      }
    } catch (error) {
      console.error(`[WA-AUTH] Error reading ${id} from MongoDB:`, error);
    }
    return null;
  };

  const writeData = async (data, id) => {
    try {
      const str = JSON.stringify(data, BufferJSON.replacer);
      await AuthModel.findByIdAndUpdate(id, { data: str }, { upsert: true });
    } catch (error) {
      console.error(`[WA-AUTH] Error writing ${id} to MongoDB:`, error);
    }
  };

  const removeData = async (id) => {
    try {
      await AuthModel.findByIdAndDelete(id);
    } catch (error) {
      console.error(`[WA-AUTH] Error deleting ${id} from MongoDB:`, error);
    }
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(value, key));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds')
  };
};

export const clearAuthData = async () => {
  try {
    const AuthModel = mongoose.models.WhatsAppAuth || mongoose.model('WhatsAppAuth', mongoose.Schema({}));
    await AuthModel.deleteMany({});
    console.log('🗑️ [WA-AUTH] MongoDB auth collection cleared (Logout/Reset)');
  } catch (error) {
    console.error('❌ [WA-AUTH] Error clearing MongoDB auth:', error);
  }
};
