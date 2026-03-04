import express from 'express';
import authRoutes from './authRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import cartRoutes from './cartRoutes.js';
import wishlistRoutes from './wishlistRoutes.js';
import adminRoutes from './adminRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import orderRoutes from './orderRoutes.js';
import productRoutes from './productRoutes.js';
import { 
  getAllProducts as getAllProductsPublic, 
  getProduct as getProductPublic 
} from '../controllers/productController.js';
import { getOrder } from '../controllers/orderController.js';

const router = express.Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/upload', uploadRoutes);
router.use('/payment', paymentRoutes);
router.use('/cart', cartRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/admin', adminRoutes);
router.use('/notifications', notificationRoutes);
router.use('/orders', orderRoutes);
router.use('/products', productRoutes);

// Public product routes (no auth required for viewing)
// Note: Individual product routes are handled by productRoutes.js
// This is just a fallback for public GET
router.get('/products', getAllProductsPublic);
router.get('/products/:id', getProductPublic);

// Public order lookup for payment polling (no auth required)
router.get('/orders/:id', getOrder);

export default router;

