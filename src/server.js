// Load environment variables FIRST - before any other imports use them
import dotenv from 'dotenv';
dotenv.config();

import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import * as Sentry from '@sentry/node';

// Initialize Sentry Observability (Layer 12: Error Tracking & Observability)
export const initSentry = (dsn = process.env.SENTRY_DSN) => {
  const cleanDsn = dsn?.trim();
  if (!cleanDsn) {
    console.warn('⚠️ SENTRY_DSN is not configured. Sentry observability will remain inert.');
    return null;
  }

  try {
    Sentry.init({
      dsn: cleanDsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    console.log('📡 Sentry observability initialized successfully.');
    return Sentry.getClient();
  } catch (err) {
    console.warn('⚠️ Failed to initialize Sentry:', err.message);
    return null;
  }
};

// Initialize Sentry with environment configuration
initSentry();

// Global Process-Level Error Handlers (Unhandled Promise Rejections & Uncaught Exceptions)
export const handleUnhandledRejection = (reason) => {
  console.error('🔥 UNHANDLED PROMISE REJECTION:', reason);
  if (process.env.SENTRY_DSN || Sentry.getClient()) {
    Sentry.captureException(reason, {
      extra: { type: 'unhandledRejection' }
    });
  }
};

export const handleUncaughtException = (error) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', error);
  if (process.env.SENTRY_DSN || Sentry.getClient()) {
    Sentry.captureException(error, {
      extra: { type: 'uncaughtException' }
    });
  }
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
};

process.on('unhandledRejection', handleUnhandledRejection);
process.on('uncaughtException', handleUncaughtException);

// 🚨 CRITICAL: Exit immediately if JWT_SECRET is not configured
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing! Set it in .env file or Railway Environment Variables.");
  process.exit(1);
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { validateEnv } from './config/checkEnv.js';
import { connectDB } from './config/db.js';
import { initBackupService } from './services/backupService.js';
import { initMpesaSyncCron } from './scripts/stkQueryCron.js';
import { initStatusCron } from './services/statusCron.js';
import { initHeroCron } from './services/heroCron.js';

import routes from './routes/index.js';
import settingRoutes from './routes/settingRoutes.js';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate all environment variables at startup
const isEnvValid = validateEnv();
if (!isEnvValid) {
  console.error('❌ Server startup aborted due to missing critical environment variables.');
  process.exit(1);
}

// Initialize Express app
const app = express();

// Trust the first proxy (Railway/Load Balancer) to fix rate-limiting IP issues
app.set('trust proxy', 1);

// Get frontend URL from environment or use default
const frontendUrl = process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com';
console.log(`🌐 Frontend URL configured: ${frontendUrl}`);

// Whitelist allowed domains (must be defined before any cors() middleware)
const allowedOrigins = [
  'https://www.seekonapparelglobal.com',
  'https://seekonapparelglobal.com',
  'http://localhost:5173',
  'http://localhost:5177',
  'http://localhost:3000',
  'http://4.224.81.245',
  frontendUrl,
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    
    const originClean = origin.trim().toLowerCase();
    
    // Check if origin matches any whitelisted origin or domain patterns
    const isAllowed = 
      allowedOrigins.includes(originClean) ||
      /^https?:\/\/localhost(:\d+)?$/.test(originClean) ||
      /^https:\/\/([a-z0-9-]+\.)*seekonapparelglobal\.com$/.test(originClean) ||
      /^https:\/\/([a-z0-9-]+\.)*seekon-apparel\.vercel\.app$/.test(originClean) ||
      /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/.test(originClean);
      
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 204
};

// Handle preflight before other middleware
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Global rate limiting — SPAs fire many parallel GETs on load; keep strict limits on writes/auth
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: (req) => {
    if (req.method === 'OPTIONS') return true;
    const path = req.originalUrl || req.path || '';
    if (req.method === 'GET' && (
      path.startsWith('/api/settings') ||
      path.startsWith('/api/products') ||
      path.startsWith('/api/categories') ||
      path === '/api/auth/me' ||
      path === '/health' ||
      path === '/'
    )) {
      return true;
    }
    return false;
  },
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Helmet — cross-origin policy must not block browser API calls from the storefront
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '✅ Seekon Backend API is running...',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      upload: '/api/upload',
      payment: '/api/payment',
      cart: '/api/cart',
      wishlist: '/api/wishlist',
      admin: '/api/admin'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Rewrite double api prefixes or legacy versioning paths for compatibility
app.use((req, res, next) => {
  if (req.url.startsWith('/api/api/')) {
    console.log(`🔄 Rewriting double API path: ${req.url} -> ${req.url.replace('/api/api/', '/api/')}`);
    req.url = req.url.replace('/api/api/', '/api/');
  }
  if (req.url === '/api/v1/admin/bot-status') {
    req.url = '/api/admin/bot-status';
  }
  next();
});

// API Routes
app.use('/api', routes);

// Settings routes - mounted directly with /api/settings prefix
app.use('/api/settings', settingRoutes);

// Sentry Express error handler (instruments Express errors before custom handler)
Sentry.setupExpressErrorHandler(app);

// Global Error Handler (Must be after Sentry setup and routes)
export const sentryErrorHandler = (err, req, res, next) => {
  console.error('🔥 CRITICAL ERROR:', err.stack || err);
  
  const statusCode = err.statusCode || err.status || 500;

  // Report critical errors (HTTP 5xx or unhandled server errors) to Sentry before responding
  if (statusCode >= 500 && (process.env.SENTRY_DSN || Sentry.getClient())) {
    Sentry.captureException(err, {
      extra: {
        path: req.originalUrl || req.url,
        method: req.method,
        statusCode,
        ip: req.ip || req.headers?.['x-forwarded-for'],
      }
    });
  }

  const message = process.env.NODE_ENV === 'production' 
    ? 'Something went wrong on our end. We are looking into it.' 
    : err.message;

  res.status(statusCode).json({
    success: false,
    message: message
  });
};

app.use(sentryErrorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Server configuration - Railway assigns its own port
const PORT = process.env.PORT || 5000;

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // Event-driven MongoDB backup → Google Drive (debounced on Paystack success)
    initBackupService();

    // Start M-Pesa status synchronization cron job
    initMpesaSyncCron();

    // Start WhatsApp Status Expiry Cron Job
    initStatusCron();
    
    // Start Hero Media Expiry Cron Job
    initHeroCron();

    // Start background image worker
    await import('./services/imageWorker.js');

    // Start listening
    const serverInstance = app.listen(PORT, () => {
      const isProduction = process.env.NODE_ENV === 'production';
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`✅ API URL: ${isProduction ? 'https://api.seekonapparelglobal.com' : 'http://localhost:' + PORT}`);
    });
    return serverInstance;
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

// Start the server (skip when running in automated test mode to allow custom runners)
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, startServer };
export default app;

