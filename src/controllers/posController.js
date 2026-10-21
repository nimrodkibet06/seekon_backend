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
    const query = { status: { $ne: 'inactive' } };

    if (q && q.trim()) {
      const cleanQ = q.trim();
      const escapedQ = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedQ, 'i');

      query.$or = [
        { name: regex },
        { barcode: regex },
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
 * @desc    Generate printable A4 grid of Code 128 barcode stickers for a product (Direct Download)
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
    // Direct download attachment instead of opening inline print dialog
    res.setHeader('Content-Disposition', `attachment; filename="Barcode-${safeFilename}.pdf"`);
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
 * @desc    Generate printable A4 grid of Code 128 barcode stickers for a category (Direct Download)
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

    const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    // Direct download attachment
    res.setHeader('Content-Disposition', `attachment; filename="Barcodes-${safeCategory}.pdf"`);
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
 * @desc    Execute sale: atomically deduct stock, save order (walk-in or social POD), generate PDF, dispatch WhatsApp
 * @access  Private (Admin, Cashier)
 */
export const checkoutPOSSale = async (req, res) => {
  try {
    const {
      items = [],
      customerPhone = '',
      customerName = '',
      payments = { cash: 0, mpesa: 0 },
      paymentMethod = 'Split',
      notes = '',
      pendingOrderId = null,
      sendWhatsAppReceipt: shouldSendReceipt = true,
      // Social Media / Pay on Delivery (POD) fields
      orderType = 'walk-in', // 'walk-in' | 'social-delivery'
      socialPlatform = 'none', // 'none' | 'instagram' | 'whatsapp' | 'tiktok'
      deliveryDetails = null
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty. Add items before completing sale.'
      });
    }

    const isSocialDelivery = orderType === 'social-delivery';

    // 1. Validate Delivery Details if social-delivery
    let deliveryFee = 0;
    let finalCustomerName = (customerName || '').trim();
    let finalPhone = (customerPhone || '').trim();
    let deliveryLocation = '';
    let riderNotes = '';

    if (isSocialDelivery) {
      if (!deliveryDetails || !deliveryDetails.customerName?.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Customer Name is required for social delivery orders'
        });
      }
      if (!deliveryDetails.customerPhone?.trim() && !customerPhone.trim()) {
        return res.status(400).json({
          success: false,
          message: 'WhatsApp Phone Number is required for social delivery orders'
        });
      }
      if (!deliveryDetails.location?.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Delivery Location / Address is required'
        });
      }

      finalCustomerName = deliveryDetails.customerName.trim();
      finalPhone = deliveryDetails.customerPhone ? deliveryDetails.customerPhone.trim() : customerPhone.trim();
      deliveryLocation = deliveryDetails.location.trim();
      deliveryFee = Math.max(0, Number(deliveryDetails.deliveryFee || 0));
      riderNotes = (deliveryDetails.riderNotes || '').trim();
    } else {
      finalCustomerName = finalCustomerName || 'Walk-in Customer';
    }

    const cleanPhone = finalPhone ? normalizePhone(finalPhone) : '';

    // 2. Validate Stock Availability & Calculate Items Subtotal
    let itemsSubtotal = 0;
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
      itemsSubtotal += itemPrice * reqQty;

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

    // Grand Total including optional delivery fee
    const grandTotal = itemsSubtotal + deliveryFee;

    // 3. Payment & Balance Due Calculations
    const cashAmount = Math.max(0, Number(payments.cash || 0));
    const mpesaAmount = Math.max(0, Number(payments.mpesa || 0));
    const totalTendered = cashAmount + mpesaAmount;

    let paymentStatus = 'paid';
    let amountPaid = totalTendered;
    let balanceDue = 0;

    if (isSocialDelivery) {
      if (totalTendered >= grandTotal) {
        paymentStatus = 'paid';
        balanceDue = 0;
      } else if (totalTendered > 0) {
        paymentStatus = 'partial_deposit';
        balanceDue = Math.max(0, grandTotal - totalTendered);
      } else {
        paymentStatus = 'pending_pod';
        balanceDue = grandTotal;
      }
    } else {
      // Walk-in requires full immediate payment
      if (totalTendered < grandTotal) {
        return res.status(400).json({
          success: false,
          message: `Total payment (KES ${totalTendered.toLocaleString()}) is less than total amount (KES ${grandTotal.toLocaleString()})`
        });
      }
      paymentStatus = 'paid';
      amountPaid = grandTotal;
      balanceDue = 0;
    }

    // 4. Atomically Deduct Stock from Main Product Pool (Stock is reserved)
    for (const item of orderItems) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: {
          stock: -item.quantity,
          sold: item.quantity
        }
      });
    }

    // 5. Customer Account Lookup & Linking
    let matchedUserId = null;
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
        if (!finalCustomerName || finalCustomerName === 'Walk-in Customer') {
          finalCustomerName = matchedUser.name;
        }
      }
    }

    // 6. Create Order Record in MongoDB
    const isPaid = paymentStatus === 'paid';
    const cleanPlatform = ['instagram', 'whatsapp', 'tiktok'].includes(socialPlatform?.toLowerCase())
      ? socialPlatform.toLowerCase()
      : 'none';

    const order = await Order.create({
      items: orderItems,
      totalAmount: grandTotal,
      shippingPrice: deliveryFee,
      orderType: isSocialDelivery ? 'social-delivery' : 'walk-in',
      socialPlatform: cleanPlatform,
      paymentStatus,
      amountPaid,
      balanceDue,
      paymentMethod: (cashAmount > 0 && mpesaAmount > 0) 
        ? 'Split' 
        : (cashAmount > 0 ? 'Cash' : (mpesaAmount > 0 ? 'M-Pesa' : (isSocialDelivery ? 'POD' : 'Cash'))),
      payments: {
        cash: cashAmount,
        mpesa: mpesaAmount
      },
      deliveryDetails: {
        customerName: finalCustomerName,
        customerPhone: cleanPhone,
        location: deliveryLocation,
        deliveryFee,
        riderNotes
      },
      orderSource: cleanPlatform === 'whatsapp' ? 'whatsapp' : 'pos',
      user: matchedUserId,
      cashier: req.user?._id,
      isPaid,
      paidAt: isPaid ? new Date() : null,
      status: isSocialDelivery ? 'processing' : 'delivered',
      guestPhone: cleanPhone,
      contactEmail: `${isSocialDelivery ? 'delivery' : 'pos'}-${Date.now()}@seekon.local`,
      shippingAddress: {
        name: finalCustomerName,
        phone: cleanPhone,
        address: deliveryLocation || 'Seekon Physical Store Walk-in',
        city: 'Nairobi',
        postalCode: '00100'
      },
      notes: notes || (isSocialDelivery ? `Social Delivery (${cleanPlatform.toUpperCase()})` : 'In-store POS Walk-in Sale')
    });

    // 7. Generate Branded PDF Document (Dispatch Slip or Paid Receipt)
    const receiptBuffer = await generateReceiptPDF(order, {
      cashierName: req.user?.name || req.user?.email || 'Store Cashier'
    });

    // 8. Dispatch PDF via Baileys WhatsApp Bot (if requested and phone provided)
    let whatsappDispatched = false;
    let whatsappError = null;

    if (shouldSendReceipt && cleanPhone) {
      try {
        const waResult = await sendWhatsAppReceipt(cleanPhone, receiptBuffer, order._id, grandTotal, {
          paymentStatus,
          balanceDue,
          amountPaid,
          customerName: finalCustomerName,
          location: deliveryLocation,
          socialPlatform: cleanPlatform
        });
        whatsappDispatched = waResult.success;
      } catch (err) {
        console.error('WhatsApp receipt dispatch failed:', err.message);
        whatsappError = err.message;
      }
    }

    // 9. If checkout originated from WhatsApp Queue, mark PendingOrder completed
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
      message: isSocialDelivery 
        ? 'Delivery order logged & dispatch slip generated'
        : 'Sale completed and stock deducted successfully',
      order: {
        id: order._id,
        orderType: order.orderType,
        socialPlatform: order.socialPlatform,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount,
        amountPaid: order.amountPaid,
        balanceDue: order.balanceDue,
        deliveryDetails: order.deliveryDetails,
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
 * @route   GET /api/pos/deliveries
 * @desc    Fetch active social media / POD orders awaiting delivery & reconciliation
 * @access  Private (Admin, Cashier)
 */
export const getPendingDeliveries = async (req, res) => {
  try {
    const deliveries = await Order.find({
      orderType: 'social-delivery',
      paymentStatus: { $in: ['pending_pod', 'partial_deposit'] },
      status: { $ne: 'cancelled' }
    })
      .sort({ createdAt: -1 })
      .populate('cashier', 'name email')
      .populate('items.product', 'name price stock image')
      .lean();

    res.status(200).json({
      success: true,
      count: deliveries.length,
      deliveries
    });
  } catch (error) {
    console.error('Error fetching pending deliveries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending deliveries'
    });
  }
};

/**
 * @route   POST /api/pos/orders/:id/complete-payment
 * @desc    Reconcile delivery order: complete balance payment, mark paid, dispatch final official receipt
 * @access  Private (Admin, Cashier)
 */
export const completeDeliveryPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { payments = { cash: 0, mpesa: 0 }, paymentMethod = 'Split', notes = '' } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'cancelled' || order.paymentStatus === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot complete payment on a cancelled order' });
    }

    if (order.paymentStatus === 'paid') {
      return res.status(400).json({ success: false, message: 'Order has already been paid in full' });
    }

    const cashAdded = Math.max(0, Number(payments.cash || 0));
    const mpesaAdded = Math.max(0, Number(payments.mpesa || 0));
    const totalTendered = cashAdded + mpesaAdded;

    order.payments = {
      cash: (order.payments?.cash || 0) + cashAdded,
      mpesa: (order.payments?.mpesa || 0) + mpesaAdded
    };

    order.amountPaid = (order.amountPaid || 0) + totalTendered;
    order.balanceDue = Math.max(0, order.totalAmount - order.amountPaid);

    if (order.balanceDue === 0 || totalTendered >= (order.balanceDue || 0)) {
      order.paymentStatus = 'paid';
      order.isPaid = true;
      order.paidAt = new Date();
      order.status = 'delivered';
      order.balanceDue = 0;
    } else {
      order.paymentStatus = 'partial_deposit';
    }

    if (paymentMethod) {
      order.paymentMethod = paymentMethod;
    }
    if (notes) {
      order.notes = `${order.notes || ''} • Reconciled: ${notes}`.trim();
    }
    order.cashier = req.user?._id;

    await order.save();

    // Generate Final Official Paid E-Receipt
    const receiptBuffer = await generateReceiptPDF(order, {
      cashierName: req.user?.name || req.user?.email || 'Store Cashier'
    });

    // Send final official receipt to customer's WhatsApp
    const customerPhone = order.deliveryDetails?.customerPhone || order.guestPhone || order.shippingAddress?.phone;
    let whatsappDispatched = false;
    let whatsappError = null;

    if (customerPhone) {
      try {
        const waResult = await sendWhatsAppReceipt(customerPhone, receiptBuffer, order._id, order.totalAmount, {
          paymentStatus: order.paymentStatus,
          balanceDue: order.balanceDue,
          amountPaid: order.amountPaid,
          customerName: order.deliveryDetails?.customerName
        });
        whatsappDispatched = waResult.success;
      } catch (err) {
        console.error('Failed to send final WhatsApp receipt:', err.message);
        whatsappError = err.message;
      }
    }

    res.status(200).json({
      success: true,
      message: 'Delivery payment completed & official receipt dispatched',
      order: {
        id: order._id,
        paymentStatus: order.paymentStatus,
        status: order.status,
        amountPaid: order.amountPaid,
        balanceDue: order.balanceDue,
        payments: order.payments
      },
      whatsappDispatched,
      whatsappError,
      receiptBase64: receiptBuffer.toString('base64')
    });
  } catch (error) {
    console.error('Error completing delivery payment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to complete delivery payment'
    });
  }
};

/**
 * @route   POST /api/pos/orders/:id/cancel-delivery
 * @desc    Cancel a delivery order & automatically restock inventory via $inc
 * @access  Private (Admin, Cashier)
 */
export const cancelDeliveryAndRestock = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Customer cancelled or delivery returned' } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'cancelled' || order.paymentStatus === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Order is already cancelled' });
    }

    // Atomically increment stock back to each product in Product collection
    for (const item of order.items || []) {
      if (item.product) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: {
            stock: item.quantity,
            sold: -item.quantity
          }
        });
      }
    }

    order.paymentStatus = 'cancelled';
    order.status = 'cancelled';
    order.notes = `${order.notes || ''} • Cancelled & Restocked: ${reason}`.trim();
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully and product inventory restocked',
      order: {
        id: order._id,
        status: order.status,
        paymentStatus: order.paymentStatus
      }
    });
  } catch (error) {
    console.error('Error cancelling delivery order:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel delivery order'
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

    const isDispatchSlip = order.paymentStatus === 'pending_pod' || order.paymentStatus === 'partial_deposit';
    const prefix = isDispatchSlip ? 'Dispatch-Slip' : 'Receipt';
    const safeRef = String(order._id).slice(-6).toUpperCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${prefix}-SKN-${safeRef}.pdf"`);
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
