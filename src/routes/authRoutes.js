import express from 'express';
import { register, login, getMe, unifiedAuth, updateProfile, forgotPassword, resetPassword, verifyEmail, resendVerificationEmail, verifyOTP, sendVerificationCode } from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

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
router.post('/login', login);

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
router.post('/forgot-password', forgotPassword);

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

