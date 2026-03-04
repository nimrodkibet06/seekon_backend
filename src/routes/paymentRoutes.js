import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  initiateMpesaPayment,
  initiateFlutterwavePayment,
  mpesaCallback,
  flutterwaveCallback,
  getUserTransactions,
  queryMpesaTransaction
} from '../controllers/paymentController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Rate limiter for STK push - prevent spam/harassment
const stkLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3, // 3 requests per minute per IP
  message: { message: "Too many payment requests. Please wait a minute and try again." }
});

// All payment routes except callbacks require authentication
router.post('/mpesa', authMiddleware, stkLimiter, initiateMpesaPayment);
router.post('/mpesa/query', authMiddleware, queryMpesaTransaction);
router.post('/flutterwave', authMiddleware, initiateFlutterwavePayment);

// Callback routes - NO auth middleware - Safaricom & Flutterwave do NOT send auth headers
// These webhooks come directly from payment providers
router.post('/mpesa-callback', mpesaCallback);
router.get('/flutterwave-callback', flutterwaveCallback);

router.get('/transactions/:userEmail', authMiddleware, getUserTransactions);

export default router;
