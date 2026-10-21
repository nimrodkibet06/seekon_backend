import Product from '../models/Product.js';
import Order from '../models/Order.js';
import PendingOrder from '../models/PendingOrder.js';
import User from '../models/User.js';
import { getProductBarcode, generateBarcodeSheetPDF } from '../services/barcodeService.js';
import { generateReceiptPDF } from '../services/receiptService.js';
import { sendWhatsAppReceipt } from '../config/whatsapp.js';
import { normalizePhone } from '../utils/phoneFormatter.js';

/**
 * @route   GET /api/pos/products/search
 * @desc    Search products by name, barcode, or SKU with live stock counts
 * @access  Private (Admin, Cashier)
 */
export const searchProductsForPOS = async (req, res) => {
  try {
    const { q = '', limit = 1000, category = '', inStock } = req.query;
    // Don't exclude active inventory - pull full product catalog
    const query = { status: { $ne: 'inactive' } };

    if (q && q.trim()) {
      const cleanQ = q.trim();
      const regex = new RegExp(cleanQ, 'i');

      query.$or = [
        { name: regex },
        { barcode: cleanQ },
        { sku: regex },
        { brand: regex },
        { category: regex }
      ];
    }

    if (category && category !== 'All' && category !== 'ALL') {
      query.category = new RegExp(`^${category}$`, 'i');
    }

    if (inStock === 'true' || inStock === true) {
      query.stock = { $gt: 0 };
    }

    const maxLimit = Math.min(2000, parseInt(limit, 10) || 1000);

    const products = await Product.find(query)
      .select('name price originalPrice discount stock inStock sizes colors category subCategory brand image images barcode sku isFlashSale flashSalePrice saleStartTime saleEndTime createdAt')
      .sort({ createdAt: -1 })
      .limit(maxLimit)
      .lean();

    // Ensure barcode is populated on every returned product
    const enhancedProducts = products.map(prod => ({
      ...prod,
      image: prod.image || prod.images?.[0] || '',
      images: prod.images || (prod.image ? [prod.image] : []),
      stock: typeof prod.stock === 'number' ? prod.stock : 0,
      inStock: (typeof prod.stock === 'number' ? prod.stock > 0 : true) && prod.inStock !== false,
      barcode: getProductBarcode(prod)
    }));

    res.status(200).json({
      success: true,
      count: enhancedProducts.length,
      products: enhancedProducts
    });
  } catch (error) {
    console.error('POS product search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search products for POS'
    });
  }
};

/**
 * @route   GET /api/pos/customers/lookup
 * @desc    Lookup customer account by phone number
 * @access  Private (Admin, Cashier)
 */
export const lookupCustomerByPhone = async (req, res) => {
  try {
    const { phone = '' } = req.query;
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) {
      return res.status(400).json({ success: false, message: 'Valid phone number required' });
    }

    const last9 = cleanPhone.slice(-9);
    const user = await User.findOne({
      $or: [
        { phoneNumber: { $regex: last9 } },
        { phone: { $regex: last9 } }
      ]
    }).select('_id name email phoneNumber role').lean();

    if (!user) {
      return res.status(200).json({
        success: true,
        found: false,
        customerPhone: cleanPhone,
        message: 'No registered user found with this phone number'
      });
    }

    res.status(200).json({
      success: true,
      found: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phoneNumber || user.phone || cleanPhone
      }
    });
  } catch (error) {
    console.error('Customer lookup error:', error);
    res.status(500).json({ success: false, message: 'Failed to lookup customer' });
  }
};

/**
 * @route   GET /api/pos/barcodes/product/:id
 * @desc    Generate printable A4 grid of Code 128 barcode stickers for a product
 * @access  Private (Admin, Cashier)
 */
export const generateProductBarcodeSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const copies = parseInt(req.query.copies, 10) || 21; // 21 stickers fills 1 standard A4 sheet

    const product = await Product.findById(id).lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const barcode = getProductBarcode(product);
    const stickerItem = {
      name: product.name,
      price: product.price,
      barcode,
      category: product.category || 'Apparel'
    };

    const items = Array(copies).fill(stickerItem);

    const pdfBuffer = await generateBarcodeSheetPDF({
      items,
      title: `${product.name} Barcode Stickers`,
      sheetSubtitle: `Code 128 • SKU/Barcode: ${barcode} • ${copies} Stickers`
    });

    const safeFilename = product.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Barcode-${safeFilename}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.end(pdfBuffer);
  } catch (error) {
    console.error('Generate barcode sheet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate barcode sheet PDF'
    });
  }
};

/**
 * @route   GET /api/pos/barcodes/category/:category
 * @desc    Generate printable A4 grid of Code 128 barcode stickers for a category
 * @access  Private (Admin, Cashier)
 */
export const generateCategoryBarcodeSheet = async (req, res) => {
  try {
    const { category } = req.params;
    const products = await Product.find({
      category: new RegExp(`^${category}$`, 'i'),
      status: { $ne: 'inactive' }
    }).lean();

    if (!products.length) {
      return res.status(404).json({ success: false, message: 'No products found in category' });
    }

    const items = products.map(p => ({
      name: p.name,
      price: p.price,
      barcode: getProductBarcode(p),
      category: p.category
    }));

    const pdfBuffer = await generateBarcodeSheetPDF({
      items,
      title: `${category.toUpperCase()} Barcodes`,
      sheetSubtitle: `Category Collection (${items.length} Products)`
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Barcodes-${category}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.end(pdfBuffer);
  } catch (error) {
    console.error('Generate category barcodes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate category barcodes PDF'
    });
  }
};

/**
 * @route   POST /api/pos/checkout
 * @desc    Execute walk-in sale: atomically deduct stock, save order, generate PDF receipt, dispatch via WhatsApp
 * @access  Private (Admin, Cashier)
 */
export const checkoutPOSSale = async (req, res) => {
  try {
    const {
      items = [],
      customerPhone = '',
      customerName = 'Walk-in Customer',
      payments = { cash: 0, mpesa: 0 },
      paymentMethod = 'Split',
      notes = '',
      pendingOrderId = null
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty. Add items before completing sale.'
      });
    }

    // 1. Validate Stock Availability & Calculate Total
    let calculatedTotal = 0;
    const orderItems = [];

    for (const item of items) {
      if (!item.productId && !item._id) {
        return res.status(400).json({
          success: false,
          message: `Product ID is required for item "${item.name}"`
        });
      }

      const prodId = item.productId || item._id;
      const product = await Product.findById(prodId);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product "${item.name}" not found in inventory`
        });
      }

      const reqQty = Number(item.quantity) || 1;
      if (product.stock < reqQty) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.name}". Available: ${product.stock}, Requested: ${reqQty}`
        });
      }

      const itemPrice = Number(item.price ?? product.price);
      calculatedTotal += itemPrice * reqQty;

      orderItems.push({
        product: product._id,
        name: product.name,
        price: itemPrice,
        quantity: reqQty,
        size: item.size || 'Standard',
        color: item.color || 'Standard',
        image: product.image || (product.images?.[0] || '')
      });
    }

    // 2. Validate Payment Breakdown
    const cashAmount = Math.max(0, Number(payments.cash || 0));
    const mpesaAmount = Math.max(0, Number(payments.mpesa || 0));
    const totalTendered = cashAmount + mpesaAmount;

    if (totalTendered < calculatedTotal) {
      return res.status(400).json({
        success: false,
        message: `Total payment (KES ${totalTendered.toLocaleString()}) is less than total amount (KES ${calculatedTotal.toLocaleString()})`
      });
    }

    // 3. Atomically Deduct Stock from Main Product Pool
    for (const item of orderItems) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: {
          stock: -item.quantity,
          sold: item.quantity
        }
      });
    }

    // 4. Create Order Record and optionally link customer user account
    const cleanPhone = customerPhone ? normalizePhone(customerPhone) : '';
    let matchedUserId = null;
    let finalCustomerName = customerName || 'Walk-in Customer';

    if (cleanPhone) {
      const last9 = cleanPhone.slice(-9);
      const matchedUser = await User.findOne({
        $or: [
          { phoneNumber: { $regex: last9 } },
          { phone: { $regex: last9 } }
        ]
      }).select('_id name email phoneNumber');

      if (matchedUser) {
        matchedUserId = matchedUser._id;
        if (!customerName || customerName === 'Walk-in Customer') {
          finalCustomerName = matchedUser.name;
        }
      }
    }

    const order = await Order.create({
      items: orderItems,
      totalAmount: calculatedTotal,
      paymentMethod: (cashAmount > 0 && mpesaAmount > 0) ? 'Split' : (cashAmount > 0 ? 'Cash' : 'M-Pesa'),
      payments: {
        cash: cashAmount,
        mpesa: mpesaAmount
      },
      orderSource: 'pos',
      user: matchedUserId,
      cashier: req.user?._id,
      isPaid: true,
      paidAt: new Date(),
      status: 'delivered', // Walk-in purchases are handed over immediately
      guestPhone: cleanPhone,
      contactEmail: `pos-${Date.now()}@seekon.local`,
      shippingAddress: {
        name: finalCustomerName,
        phone: cleanPhone,
        address: 'Seekon Physical Store Walk-in',
        city: 'Nairobi',
        postalCode: '00100'
      },
      notes: notes || 'In-store POS Walk-in Sale'
    });

    // 5. Generate Branded PDF E-Receipt in Server Memory
    const receiptBuffer = await generateReceiptPDF(order, {
      cashierName: req.user?.name || req.user?.email || 'Store Cashier'
    });

    // 6. Dispatch PDF E-Receipt via Baileys WhatsApp Bot (if customer phone provided)
    let whatsappDispatched = false;
    let whatsappError = null;

    if (cleanPhone) {
      try {
        const waResult = await sendWhatsAppReceipt(cleanPhone, receiptBuffer, order._id, calculatedTotal);
        whatsappDispatched = waResult.success;
      } catch (err) {
        console.error('WhatsApp receipt dispatch failed:', err.message);
        whatsappError = err.message;
      }
    }

    // 7. If checkout originated from WhatsApp Queue, mark PendingOrder completed
    if (pendingOrderId) {
      try {
        await PendingOrder.findByIdAndUpdate(pendingOrderId, {
          status: 'completed',
          completedOrder: order._id,
          processedBy: req.user?._id
        });
      } catch (queueErr) {
        console.error('Failed to update PendingOrder status:', queueErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Sale completed and stock deducted successfully',
      order: {
        id: order._id,
        totalAmount: order.totalAmount,
        itemsCount: orderItems.length,
        paymentMethod: order.paymentMethod,
        payments: order.payments,
        createdAt: order.createdAt
      },
      whatsappDispatched,
      whatsappError,
      receiptBase64: receiptBuffer.toString('base64')
    });
  } catch (error) {
    console.error('POS Checkout Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Checkout failed'
    });
  }
};

/**
 * @route   GET /api/pos/orders/pending
 * @desc    Fetch incoming headless WhatsApp orders queued for POS confirmation
 * @access  Private (Admin, Cashier)
 */
export const getPendingWhatsAppOrders = async (req, res) => {
  try {
    const queue = await PendingOrder.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .populate('items.product', 'name price stock image')
      .lean();

    res.status(200).json({
      success: true,
      count: queue.length,
      orders: queue
    });
  } catch (error) {
    console.error('Error fetching pending orders queue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch WhatsApp orders queue'
    });
  }
};

/**
 * @route   PATCH /api/pos/orders/pending/:id/dismiss
 * @desc    Dismiss or cancel an order in the WhatsApp queue
 * @access  Private (Admin, Cashier)
 */
export const dismissPendingOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await PendingOrder.findByIdAndUpdate(
      id,
      { status: 'dismissed', processedBy: req.user?._id },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, message: 'Queue order not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Order dismissed from queue',
      order
    });
  } catch (error) {
    console.error('Error dismissing pending order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to dismiss pending order'
    });
  }
};

/**
 * @route   GET /api/pos/receipt/:id
 * @desc    Download or view PDF e-receipt for any past order
 * @access  Private (Admin, Cashier)
 */
export const getOrderReceiptPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate('cashier', 'name email').lean();

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const receiptBuffer = await generateReceiptPDF(order, {
      cashierName: order.cashier?.name || 'Seekon Cashier'
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Receipt-SKN-${String(order._id).slice(-6).toUpperCase()}.pdf"`);
    res.setHeader('Content-Length', receiptBuffer.length);

    res.end(receiptBuffer);
  } catch (error) {
    console.error('Error generating past receipt PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate receipt PDF'
    });
  }
};
