/**
 * Centralized Environment Variable Validation
 * 
 * This file checks all required environment variables at startup.
 * - CRITICAL variables (MongoDB): Missing = server crash
 * - OPTIONAL variables (Cloudinary, Email): Missing = warning + graceful degradation
 */

import dotenv from 'dotenv';
dotenv.config();

// Track what's configured
export const envStatus = {
  critical: [],
  optional: [],
  missing: {
    critical: [],
    optional: []
  }
};

// CRITICAL: Server cannot run without these
const CRITICAL_VARS = [
  { key: 'MONGO_URI', name: 'MongoDB Connection', description: 'MongoDB connection string' },
  { key: 'JWT_SECRET', name: 'JWT Secret', description: 'Secret for signing JWT tokens - REQUIRED for authentication' }
];

// OPTIONAL: Server can run, but features will be disabled
const OPTIONAL_VARS = [
  { key: 'CLOUDINARY_CLOUD_NAME', name: 'Cloudinary Cloud Name', description: 'Cloud storage for image uploads' },
  { key: 'CLOUDINARY_API_KEY', name: 'Cloudinary API Key', description: 'API key for Cloudinary' },
  { key: 'CLOUDINARY_API_SECRET', name: 'Cloudinary API Secret', description: 'API secret for Cloudinary' },
  { key: 'RESEND_API_KEY', name: 'Resend API Key', description: 'API key for Resend email service' }
];

/**
 * Check all environment variables and return status
 */
export const validateEnv = () => {
  console.log('\n🔍 Checking Environment Variables...\n');
  console.log('=' .repeat(60));
  
  let hasCriticalMissing = false;
  
  // Check CRITICAL variables
  CRITICAL_VARS.forEach(({ key, name, description }) => {
    const value = process.env[key];
    if (value) {
      envStatus.critical.push({ key, name, value: '***configured***' });
      console.log(`✅ ${name}`);
    } else {
      envStatus.missing.critical.push({ key, name, description });
      console.log(`❌ ${name} - ${description}`);
      hasCriticalMissing = true;
    }
  });
  
  console.log('-'.repeat(60));
  
  // Check OPTIONAL variables
  OPTIONAL_VARS.forEach(({ key, name, description }) => {
    const value = process.env[key];
    if (value) {
      envStatus.optional.push({ key, name, value: '***configured***' });
      console.log(`✅ ${name}`);
    } else {
      envStatus.missing.optional.push({ key, name, description });
      console.log(`⚠️  ${name} - ${description}`);
    }
  });
  
  console.log('=' .repeat(60) + '\n');
  
  // Handle missing critical variables
  if (hasCriticalMissing) {
    console.error('❌ CRITICAL: Missing required environment variables!');
    console.error('📝 Please set the above missing variables in Railway Environment Variables.\n');
    return false;
  }
  
  // Show warnings for missing optional variables
  if (envStatus.missing.optional.length > 0) {
    console.log('⚠️  OPTIONAL: Some services will be disabled due to missing configuration:');
    envStatus.missing.optional.forEach(({ name, description }) => {
      console.log(`   - ${name}: ${description}`);
    });
    console.log('');
  }
  
  return true;
};

/**
 * Check if a specific service is configured
 */
export const isServiceConfigured = (serviceName) => {
  const serviceKeys = {
    cloudinary: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
    email: ['EMAIL_USER', 'EMAIL_PASS'],
    resend: ['RESEND_API_KEY'],
    mongodb: ['MONGO_URI'],
    jwt: ['JWT_SECRET']
  };
  
  const keys = serviceKeys[serviceName];
  if (!keys) return false;
  
  return keys.every(key => process.env[key]);
};

/**
 * Get missing configuration for a service
 */
export const getMissingConfig = (serviceName) => {
  const serviceKeys = {
    cloudinary: [
      { key: 'CLOUDINARY_CLOUD_NAME', name: 'Cloud Name' },
      { key: 'CLOUDINARY_API_KEY', name: 'API Key' },
      { key: 'CLOUDINARY_API_SECRET', name: 'API Secret' }
    ],
    resend: [
      { key: 'RESEND_API_KEY', name: 'API Key' }
    ]
  };
  
  const keys = serviceKeys[serviceName];
  if (!keys) return [];
  
  return keys.filter(({ key }) => !process.env[key]);
};

export default { validateEnv, isServiceConfigured, getMissingConfig };
