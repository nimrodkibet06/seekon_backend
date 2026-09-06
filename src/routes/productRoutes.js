import express from 'express';
import {
  getAllProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  addReview,
  canUserReview,
  migrateCategoryTypo,
  getBestSellers,
  getProcessingUploads,
  generateDescription
} from '../controllers/productController.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { uploadQueueMultiple } from '../middleware/queueUpload.js';

const router = express.Router();

// Public Routes (Everyone can see products)
router.get('/', getAllProducts);
router.get('/bestsellers', getBestSellers);

// Processing status route for monitoring background tasks (admin only)
router.get('/processing', authMiddleware, adminMiddleware, getProcessingUploads);

router.get('/:id', getProduct);

// Review Routes (Auth required - verified buyer check included)
router.post('/:id/reviews', authMiddleware, addReview);
router.get('/:id/can-review', authMiddleware, canUserReview);

// Admin Routes (Only for creating/editing) - Protected and Admin only
router.post('/', authMiddleware, adminMiddleware, uploadQueueMultiple, createProduct);
router.post('/generate-description', authMiddleware, adminMiddleware, generateDescription);
router.put('/:id', authMiddleware, adminMiddleware, updateProduct);
router.delete('/:id', authMiddleware, adminMiddleware, deleteProduct);

// Migration Routes (Admin only)
router.put('/migrate-category-typo', authMiddleware, adminMiddleware, migrateCategoryTypo);

export default router;
