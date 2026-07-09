import express from 'express';
import { getFlashSaleSettings, updateFlashSaleSettings, getHomeSettings, updateHomeSettings, getExchangeRate, updateExchangeRate, submitContactForm, subscribeNewsletter, getAuthorizedPhones, updateAuthorizedPhones } from '../controllers/settingController.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Exchange Rate (Public GET, Admin PUT)
router.get('/exchange-rate', getExchangeRate);
router.put('/exchange-rate', authMiddleware, adminMiddleware, updateExchangeRate);

// Public route to check status
router.get('/flash-sale', getFlashSaleSettings);

// Admin route to update settings
router.put('/flash-sale', authMiddleware, adminMiddleware, updateFlashSaleSettings);

// Home Page Settings (Public GET, Admin PUT)
router.get('/home', getHomeSettings);
router.put('/home', authMiddleware, adminMiddleware, updateHomeSettings);

// Contact Form (Public POST)
router.post('/contact', submitContactForm);

// Newsletter Subscribe (Public POST)
router.post('/subscribe', subscribeNewsletter);

// Authorized WhatsApp Status Phones (Admin only)
router.get('/authorized-phones', authMiddleware, adminMiddleware, getAuthorizedPhones);
router.put('/authorized-phones', authMiddleware, adminMiddleware, updateAuthorizedPhones);

export default router;
