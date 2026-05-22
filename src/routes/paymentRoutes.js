import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  initializePaystackPayment,
  verifyPaystackPayment,
  initiateFlutterwavePayment,
  flutterwaveCallback,
  getUserTransactions,
  initiateSTKPush,
  handleMpesaCallback
} from '../controllers/paymentController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Rate limiter for payment initialization - prevent spam/harassment
const paymentLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3, // 3 requests per minute per IP
  message: { message: "Too many payment requests. Please wait a minute and try again." }
});

// M-Pesa (Daraja) payment routes
router.post('/stk-push', paymentLimiter, initiateSTKPush);
router.post('/mpesa-callback', handleMpesaCallback);

// Paystack payment routes
router.post('/paystack/initialize', authMiddleware, paymentLimiter, initializePaystackPayment);
router.get('/paystack/verify', verifyPaystackPayment);

// Flutterwave routes (keeping existing)
router.post('/flutterwave', authMiddleware, paymentLimiter, initiateFlutterwavePayment);
router.get('/flutterwave-callback', flutterwaveCallback);

// Get user transactions
router.get('/transactions/:userEmail', authMiddleware, getUserTransactions);

export default router;
