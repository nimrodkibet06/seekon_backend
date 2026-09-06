import express from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
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

// Rate limiter for payment initialization - 5 requests per 15 minutes per IP
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, 
  message: { message: "Too many payment requests. Please wait 15 minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation for STK Push
const stkPushValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address'),
  body('phoneNumber')
    .matches(/^(254|0)(7|1)\d{8}$/)
    .withMessage('Please provide a valid Kenyan phone number (e.g., 2547... or 07...)'),
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('orderId').notEmpty().withMessage('Order ID is required')
];

// M-Pesa (Daraja) payment routes
router.post('/stk-push', paymentLimiter, stkPushValidation, initiateSTKPush);
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
