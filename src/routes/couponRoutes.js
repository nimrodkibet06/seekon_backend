import express from 'express';
import { 
  getCoupons, 
  createCoupon, 
  updateCoupon, 
  deleteCoupon, 
  toggleCouponStatus,
  applyCoupon,
  incrementCouponUsage 
} from '../controllers/couponController.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Public route - Apply coupon
router.post('/apply', applyCoupon);

// Protected route - Increment usage (called after successful payment)
router.post('/:code/used', authMiddleware, incrementCouponUsage);

// Admin routes - All protected by admin middleware
router.get('/', authMiddleware, adminMiddleware, getCoupons);
router.post('/', authMiddleware, adminMiddleware, createCoupon);
router.put('/:id', authMiddleware, adminMiddleware, updateCoupon);
router.delete('/:id', authMiddleware, adminMiddleware, deleteCoupon);
router.patch('/:id/toggle', authMiddleware, adminMiddleware, toggleCouponStatus);

export default router;
