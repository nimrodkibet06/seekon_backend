import express from 'express';
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  clearWishlist
} from '../controllers/wishlistController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// All wishlist routes require authentication
router.use(authMiddleware);

// Get user's wishlist
router.get('/:userId', getWishlist);

// Add item to wishlist
router.post('/:userId/add', addToWishlist);

// Remove item from wishlist
router.delete('/:userId/remove', removeFromWishlist);

// Clear wishlist
router.delete('/:userId/clear', clearWishlist);

export default router;




