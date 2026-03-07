import express from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, getMe, unifiedAuth, updateProfile, forgotPassword, resetPassword, verifyEmail, resendVerificationEmail, verifyOTP, sendVerificationCode } from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting for login attempts to prevent brute-force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: {
    success: false,
    message: 'Too many login attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for password reset requests
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset requests per hour
  message: {
    success: false,
    message: 'Too many password reset requests. Please try again after 1 hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// @route   POST /api/auth/send-code
// @desc    Send verification code to email
// @access  Public
router.post('/send-code', sendVerificationCode);

// @route   POST /api/auth/unified
// @desc    Unified login/register - auto-detects new users and signs them up
// @access  Public
router.post('/unified', unifiedAuth);

// @route   POST /api/auth/register
// @desc    Register new user
// @access  Public
router.post('/register', register);

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and complete registration
// @access  Public
router.post('/verify-otp', verifyOTP);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', loginLimiter, login);

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', authMiddleware, getMe);

// @route   PUT /api/auth/me
// @desc    Update current user profile
// @access  Private
router.put('/me', authMiddleware, updateProfile);

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', passwordResetLimiter, forgotPassword);

// @route   POST /api/auth/reset-password/:token
// @desc    Reset password with token
// @access  Public
router.post('/reset-password/:token', resetPassword);

// @route   GET /api/auth/verify-email/:token
// @desc    Verify email address
// @access  Public
router.get('/verify-email/:token', verifyEmail);

// @route   POST /api/auth/resend-verification
// @desc    Resend verification email
// @access  Public
router.post('/resend-verification', resendVerificationEmail);

export default router;

