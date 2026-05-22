import express from 'express';
import { getMyOrders, getOrder, createOrder, updateOrderStatus, deleteOrder, clearUserOrderHistory } from '../controllers/orderController.js';
import { authMiddleware, optionalAuthMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Create new order (guest checkout supported via contactEmail + ghost user)
router.post('/', optionalAuthMiddleware, createOrder);

// Get current user's orders (requires authentication)
router.get('/my-orders', authMiddleware, getMyOrders);

// Clear current user's order history (soft delete)
router.patch('/my-orders/clear', authMiddleware, clearUserOrderHistory);

// Get single order by ID (public for payment polling)
router.get('/:id', getOrder);

// Update order status/fulfillment (admin)
router.patch('/:id', authMiddleware, adminMiddleware, updateOrderStatus);

// Delete order (admin only)
router.delete('/:id', authMiddleware, adminMiddleware, deleteOrder);

export default router;
