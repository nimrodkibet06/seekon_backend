import express from 'express';
import rateLimit from 'express-rate-limit';
import { v2 as cloudinary } from 'cloudinary';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import {
  adminLogin,
  getAdminStats,
  getDashboardStats,
  getAllTransactions,
  getTransaction,
  exportTransactions,
  getAnalytics,
  cleanupAbandonedOrders
} from '../controllers/adminController.js';
import {
  getAllUsers,
  getUser,
  updateUserStatus,
  deleteUser
} from '../controllers/userController.js';
import {
  getAllProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct
} from '../controllers/productController.js';
import {
  getAllOrders,
  getOrder,
  updateOrderStatus,
  cancelOrder
} from '../controllers/orderController.js';
import {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCouponStatus
} from '../controllers/couponController.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import Notification from '../models/Notification.js';

const router = express.Router();

// Rate limiting for admin login to prevent brute-force attacks
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: {
    success: false,
    message: 'Too many admin login attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes
router.post('/login', adminLoginLimiter, adminLogin);

// Protected routes - require authentication
router.get('/stats', authMiddleware, adminMiddleware, getAdminStats);
router.get('/analytics', authMiddleware, adminMiddleware, getAnalytics);
router.get('/dashboard', authMiddleware, adminMiddleware, getDashboardStats);
router.get('/transactions', authMiddleware, adminMiddleware, getAllTransactions);
router.get('/transactions/:id', authMiddleware, getTransaction);
router.get('/transactions/export/csv', authMiddleware, adminMiddleware, exportTransactions);

// User management
router.get('/users', authMiddleware, adminMiddleware, getAllUsers);
router.get('/users/:id', authMiddleware, adminMiddleware, getUser);
router.post('/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, email, phone, password, role = 'user' } = req.body;
    
    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});
router.patch('/users/:id/status', authMiddleware, adminMiddleware, updateUserStatus);
router.patch('/users/:id/role', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    // Validate role
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be "user" or "admin"'
      });
    }
    
    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'User role updated successfully',
      user
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user role'
    });
  }
});
router.delete('/users/:id', authMiddleware, adminMiddleware, deleteUser);

// Product management
router.get('/products', authMiddleware, adminMiddleware, getAllProducts);
router.get('/products/:id', authMiddleware, adminMiddleware, getProduct);
router.post('/products', authMiddleware, adminMiddleware, createProduct);
router.put('/products/:id', authMiddleware, adminMiddleware, updateProduct);
router.delete('/products/:id', authMiddleware, adminMiddleware, deleteProduct);

// Order management
router.get('/orders', authMiddleware, adminMiddleware, getAllOrders);
router.get('/orders/:id', authMiddleware, getOrder);
router.patch('/orders/:id/status', authMiddleware, updateOrderStatus);
router.patch('/orders/:id/cancel', authMiddleware, cancelOrder);

// Cleanup route
router.delete('/cleanup-abandoned', authMiddleware, adminMiddleware, cleanupAbandonedOrders);

// Notification routes
router.get('/notifications', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .limit(20);
    
    const unreadCount = await Notification.countDocuments({ isRead: false });
    
    res.status(200).json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

router.put('/notifications/:id/read', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    
    res.status(200).json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// Cloudinary management
router.post('/cloudinary/delete', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { publicId } = req.body;
    
    const result = await cloudinary.uploader.destroy(publicId);
    
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Coupon Management Routes - FIX 404 error
router.get('/coupons', authMiddleware, adminMiddleware, getCoupons);
router.post('/coupons', authMiddleware, adminMiddleware, createCoupon);
router.put('/coupons/:id', authMiddleware, adminMiddleware, updateCoupon);
router.delete('/coupons/:id', authMiddleware, adminMiddleware, deleteCoupon);
router.patch('/coupons/:id/toggle', authMiddleware, adminMiddleware, toggleCouponStatus);

export default router;

