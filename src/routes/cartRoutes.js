import express from 'express';
import {
  getCart,
  addToCart,
  updateCartItemQuantity,
  removeFromCart,
  clearCart
} from '../controllers/cartController.js';
import { protect } from '../middleware/authMiddleware.js'; 

const router = express.Router();

// SECURITY: All cart routes require authentication
// The protect middleware verifies JWT token and sets req.user
router.use(protect);

router.get('/', getCart);                           // GET /api/cart
router.post('/add', addToCart);                     // POST /api/cart/add
// @route   PATCH /api/cart/update - Updates item quantity in cart
router.patch('/update', updateCartItemQuantity);
router.delete('/remove/:productId', removeFromCart);           // DELETE /api/cart/remove/:productId
router.delete('/clear', clearCart);                 // DELETE /api/cart/clear

export default router;
