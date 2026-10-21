import express from 'express';
import { authMiddleware, authorizeRoles } from '../middleware/auth.js';
import {
  searchProductsForPOS,
  generateProductBarcodeSheet,
  generateCategoryBarcodeSheet,
  checkoutPOSSale,
  getPendingWhatsAppOrders,
  dismissPendingOrder,
  getOrderReceiptPDF
} from '../controllers/posController.js';

const router = express.Router();

// POS routes are strictly protected for cashiers and admins
router.use(authMiddleware);
router.use(authorizeRoles('admin', 'cashier'));

/**
 * @route   GET /api/pos/verify-access
 * @desc    Verify cashier/admin authentication and POS authorization
 */
router.get('/verify-access', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'POS terminal access authorized',
    user: {
      id: req.user._id,
      email: req.user.email,
      role: req.user.role || (req.user.isAdmin ? 'admin' : 'cashier')
    }
  });
});

/**
 * @route   GET /api/pos/products/search
 * @desc    Search products by name, barcode, or SKU
 */
router.get('/products/search', searchProductsForPOS);

/**
 * @route   GET /api/pos/barcodes/product/:id
 * @desc    Generate printable A4 grid of Code 128 barcode stickers for a product
 */
router.get('/barcodes/product/:id', generateProductBarcodeSheet);

/**
 * @route   GET /api/pos/barcodes/category/:category
 * @desc    Generate printable A4 grid of Code 128 barcode stickers for a category
 */
router.get('/barcodes/category/:category', generateCategoryBarcodeSheet);

/**
 * @route   POST /api/pos/checkout
 * @desc    Execute walk-in sale: deduct stock, save order, generate PDF receipt, WhatsApp delivery
 */
router.post('/checkout', checkoutPOSSale);

/**
 * @route   GET /api/pos/orders/pending
 * @desc    Fetch incoming headless WhatsApp orders queued for POS confirmation
 */
router.get('/orders/pending', getPendingWhatsAppOrders);

/**
 * @route   PATCH /api/pos/orders/pending/:id/dismiss
 * @desc    Dismiss or cancel an order in the WhatsApp queue
 */
router.patch('/orders/pending/:id/dismiss', dismissPendingOrder);

/**
 * @route   GET /api/pos/receipt/:id
 * @desc    Download or view PDF e-receipt for any past order
 */
router.get('/receipt/:id', getOrderReceiptPDF);

export default router;
