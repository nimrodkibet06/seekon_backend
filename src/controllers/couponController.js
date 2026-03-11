const Coupon = require('../models/Coupon');
const asyncHandler = require('express-async-handler');

// @desc    Get all coupons (Admin)
// @route   GET /api/coupons
// @access  Private/Admin
const getCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find({}).sort({ createdAt: -1 });
  res.status(200).json(coupons);
});

// @desc    Create a new coupon (Admin)
// @route   POST /api/coupons
// @access  Private/Admin
const createCoupon = asyncHandler(async (req, res) => {
  const { code, discountType, discountValue, expiryDate, usageLimit, description, minPurchaseAmount, maxDiscountAmount } = req.body;

  // Check if coupon code already exists
  const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (existingCoupon) {
    res.status(400);
    throw new Error('Coupon code already exists');
  }

  const coupon = await Coupon.create({
    code: code.toUpperCase(),
    discountType,
    discountValue,
    expiryDate,
    usageLimit: usageLimit || 100,
    description: description || '',
    minPurchaseAmount: minPurchaseAmount || 0,
    maxDiscountAmount: maxDiscountAmount || null,
    isActive: true,
    usedCount: 0
  });

  res.status(201).json(coupon);
});

// @desc    Update a coupon (Admin)
// @route   PUT /api/coupons/:id
// @access  Private/Admin
const updateCoupon = asyncHandler(async (req, res) => {
  const { code, discountType, discountValue, expiryDate, usageLimit, isActive, description, minPurchaseAmount, maxDiscountAmount } = req.body;

  const coupon = await Coupon.findById(req.params.id);

  if (!coupon) {
    res.status(404);
    throw new Error('Coupon not found');
  }

  // Check if updating code to one that already exists
  if (code && code.toUpperCase() !== coupon.code) {
    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
      res.status(400);
      throw new Error('Coupon code already exists');
    }
    coupon.code = code.toUpperCase();
  }

  coupon.discountType = discountType || coupon.discountType;
  coupon.discountValue = discountValue !== undefined ? discountValue : coupon.discountValue;
  coupon.expiryDate = expiryDate || coupon.expiryDate;
  coupon.usageLimit = usageLimit || coupon.usageLimit;
  coupon.isActive = isActive !== undefined ? isActive : coupon.isActive;
  coupon.description = description !== undefined ? description : coupon.description;
  coupon.minPurchaseAmount = minPurchaseAmount !== undefined ? minPurchaseAmount : coupon.minPurchaseAmount;
  coupon.maxDiscountAmount = maxDiscountAmount !== undefined ? maxDiscountAmount : coupon.maxDiscountAmount;

  const updatedCoupon = await coupon.save();
  res.status(200).json(updatedCoupon);
});

// @desc    Delete a coupon (Admin)
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);

  if (!coupon) {
    res.status(404);
    throw new Error('Coupon not found');
  }

  await coupon.deleteOne();
  res.status(200).json({ message: 'Coupon deleted successfully' });
});

// @desc    Toggle coupon active status (Admin)
// @route   PATCH /api/coupons/:id/toggle
// @access  Private/Admin
const toggleCouponStatus = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);

  if (!coupon) {
    res.status(404);
    throw new Error('Coupon not found');
  }

  coupon.isActive = !coupon.isActive;
  const updatedCoupon = await coupon.save();
  res.status(200).json(updatedCoupon);
});

// @desc    Apply a coupon code
// @route   POST /api/coupons/apply
// @access  Public
const applyCoupon = asyncHandler(async (req, res) => {
  const { code, cartTotal } = req.body;

  if (!code || !cartTotal) {
    res.status(400);
    throw new Error('Please provide coupon code and cart total');
  }

  const coupon = await Coupon.findOne({ code: code.toUpperCase() });

  if (!coupon) {
    res.status(404);
    throw new Error('Invalid coupon code');
  }

  // Check if coupon is active
  if (!coupon.isActive) {
    res.status(400);
    throw new Error('This coupon is no longer active');
  }

  // Check if coupon has expired
  if (new Date(coupon.expiryDate) < new Date()) {
    res.status(400);
    throw new Error('This coupon has expired');
  }

  // Check usage limit
  if (coupon.usedCount >= coupon.usageLimit) {
    res.status(400);
    throw new Error('This coupon has reached its usage limit');
  }

  // Check minimum purchase amount
  if (cartTotal < coupon.minPurchaseAmount) {
    res.status(400);
    throw new Error(`Minimum purchase of KSh ${coupon.minPurchaseAmount.toLocaleString()} required for this coupon`);
  }

  // Calculate discount
  let discountAmount = 0;
  if (coupon.discountType === 'percentage') {
    discountAmount = (cartTotal * coupon.discountValue) / 100;
    
    // Apply max discount cap if set
    if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
      discountAmount = coupon.maxDiscountAmount;
    }
  } else {
    // Fixed discount
    discountAmount = coupon.discountValue;
    
    // Discount cannot exceed cart total
    if (discountAmount > cartTotal) {
      discountAmount = cartTotal;
    }
  }

  const newTotal = cartTotal - discountAmount;

  res.status(200).json({
    success: true,
    couponCode: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount: Math.round(discountAmount),
    originalTotal: cartTotal,
    newTotal: Math.round(newTotal),
    message: `${coupon.discountType === 'percentage' ? `${coupon.discountValue}%` : `KSh ${coupon.discountValue}`} discount applied!`
  });
});

// @desc    Increment coupon usage count (after successful payment)
// @route   POST /api/coupons/:code/used
// @access  Private
const incrementCouponUsage = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOne({ code: req.params.code.toUpperCase() });

  if (!coupon) {
    res.status(404);
    throw new Error('Coupon not found');
  }

  coupon.usedCount += 1;
  await coupon.save();

  res.status(200).json({ success: true, usedCount: coupon.usedCount });
});

module.exports = {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCouponStatus,
  applyCoupon,
  incrementCouponUsage
};
