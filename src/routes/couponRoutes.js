const express = require('express');
const router = express.Router();
const { 
  getCoupons, 
  createCoupon, 
  updateCoupon, 
  deleteCoupon, 
  toggleCouponStatus,
  applyCoupon,
  incrementCouponUsage 
} = require('../controllers/couponController');
const { protect, admin } = require('../middleware/authMiddleware');

// Public route - Apply coupon
router.post('/apply', applyCoupon);

// Protected route - Increment usage (called after successful payment)
router.post('/:code/used', protect, incrementCouponUsage);

// Admin routes - All protected by admin middleware
router.get('/', protect, admin, getCoupons);
router.post('/', protect, admin, createCoupon);
router.put('/:id', protect, admin, updateCoupon);
router.delete('/:id', protect, admin, deleteCoupon);
router.patch('/:id/toggle', protect, admin, toggleCouponStatus);

module.exports = router;
