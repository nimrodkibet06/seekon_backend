// Load environment variables FIRST - before any other imports use them
import dotenv from 'dotenv';
dotenv.config();

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
import { startBackupScheduler } from './services/backupService.js';
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
  frontendUrl,
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// API Routes
app.use('/api', routes);

// Settings routes - mounted directly with /api/settings prefix
app.use('/api/settings', settingRoutes);

// Global Error Handler (Must be the last middleware)
app.use((err, req, res, next) => {
  console.error('🔥 CRITICAL ERROR:', err.stack);
  
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Something went wrong on our end. We are looking into it.' 
    : err.message;

  res.status(statusCode).json({
    success: false,
    message: message
  });
});

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

    // Nightly full MongoDB backup → Resend email (00:00 server time)
    startBackupScheduler();
    
    // Start listening
    app.listen(PORT, () => {
      const isProduction = process.env.NODE_ENV === 'production';
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`✅ API URL: ${isProduction ? 'https://seekonbackend-production-da47.up.railway.app' : 'http://localhost:' + PORT}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

// Start the server
startServer();

export default app;

