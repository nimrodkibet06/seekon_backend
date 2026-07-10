import express from 'express';
import { getFlashSaleSettings, updateFlashSaleSettings, getHomeSettings, updateHomeSettings, getExchangeRate, updateExchangeRate, submitContactForm, subscribeNewsletter, getAuthorizedPhones, updateAuthorizedPhones, triggerSelfStatus, getPendingLids, approveLid, removeLid } from '../controllers/settingController.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Exchange Rate (Public GET, Admin PUT)
router.get('/exchange-rate', getExchangeRate);
router.put('/exchange-rate', authMiddleware, adminMiddleware, updateExchangeRate);

// Flash Sale Settings
router.get('/flash-sale', getFlashSaleSettings);
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
router.post('/trigger-self-status', authMiddleware, adminMiddleware, triggerSelfStatus);

// WhatsApp Status LID Management (Admin only)
// GET  /status-lids          → returns { pending: [...], approved: [...] }
// POST /status-lids/approve  → body { lid } → moves lid from pending to authorized
// DELETE /status-lids/remove → body { lid } → removes lid from authorized
router.get('/status-lids', authMiddleware, adminMiddleware, getPendingLids);
router.post('/status-lids/approve', authMiddleware, adminMiddleware, approveLid);
router.delete('/status-lids/remove', authMiddleware, adminMiddleware, removeLid);

export default router;
