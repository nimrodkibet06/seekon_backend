import Groq from 'groq-sdk';

// Get keys from env. Supported formats:
// GROQ_API_KEYS="gsk_key1,gsk_key2,gsk_key3"
// Falling back to GROQ_API_KEY if GROQ_API_KEYS is not defined.
const getKeys = () => {
  const keysStr = process.env.GROQ_API_KEYS;
  if (keysStr) {
    return keysStr.split(',').map(k => k.trim()).filter(Boolean);
  }
  if (process.env.GROQ_API_KEY) {
    return [process.env.GROQ_API_KEY.trim()];
  }
  return [];
};

const keys = getKeys();
let currentIndex = 0;

/**
 * Returns a new Groq client instance using the next API key in the rotation.
 * @returns {Groq} Groq client instance
 */
export const getGroqClient = () => {
  if (keys.length === 0) {
    console.warn('⚠️ No Groq API keys configured. Calls will fail.');
    return new Groq({ apiKey: '' });
  }

  const selectedKey = keys[currentIndex];
  console.log(`🤖 [GROQ ROTATION]: Using key index ${currentIndex} of ${keys.length}`);
  
  // Increment index for next call
  currentIndex = (currentIndex + 1) % keys.length;

  return new Groq({ apiKey: selectedKey });
};
