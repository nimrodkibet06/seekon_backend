import Order from '../models/Order.js';
import Product from '../models/Product.js';
import SystemLog from '../models/SystemLog.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { sendPushNotificationToAdmins } from '../routes/notificationRoutes.js';
import { sendOrderConfirmationEmail, sendOrderStatusUpdateEmail, sendAdminNotification } from '../utils/email.js';

// Create Order
export const createOrder = async (req, res) => {
  try {
    // Log the incoming payload to see what frontend actually sent
    console.log("🔥 INCOMING ORDER REQUEST BODY:", JSON.stringify(req.body, null, 2));
    console.log("👤 AUTH USER:", JSON.stringify(req.user, null, 2));
    
    const {
      items,
      paymentMethod,
      shippingAddress,
      deliveryDate,
      convenientTime
    } = req.body;

    // Get user from auth middleware - MUST exist since route is protected
    const userId = req.user?.userId || req.user?._id || req.user?.id;
    
    // CRITICAL: Do NOT allow guest checkout if authenticated
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in to place an order.'
      });
    }
    
    // Get user email and name from database since JWT doesn't include email/name
    let userEmail = req.user?.email;
    let userName = req.user?.name;
    if (!userEmail || !userName) {
      try {
        const User = (await import('../models/User.js')).default;
        const user = await User.findById(userId).select('email name');
        userEmail = user?.email;
        userName = user?.name;
      } catch (e) {
        console.error('Error fetching user data:', e);
      }
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No items in order'
      });
    }

    // Keep the original paymentMethod format from frontend - don't normalize
    const normalizedPaymentMethod = paymentMethod || 'M-Pesa';

    // Map shippingAddress fields to match model
    const mappedShippingAddress = shippingAddress ? {
      name: `${shippingAddress.firstName || ''} ${shippingAddress.lastName || ''}`.trim(),
      phone: shippingAddress.phone,
      address: shippingAddress.address,
      city: shippingAddress.city,
      postalCode: shippingAddress.zipCode
    } : {};

    // SECURITY FIX: Recalculate prices server-side to prevent price manipulation
    // Fetch current prices from database to prevent frontend manipulation
    const productIds = items.map(item => item.product?._id || item.product || item.productId?._id || item.productId || item.id || item._id).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds } }).select('name price image');
    const productPriceMap = {};
    products.forEach(p => { productPriceMap[p._id.toString()] = p; });

    let calculatedTotal = 0;
    const orderItems = items.map(item => {
      const extractedId = item.product?._id || item.product || item.productId?._id || item.productId || item.id || item._id;
      const dbProduct = productPriceMap[extractedId];
      const finalPrice = dbProduct ? dbProduct.price : (item.price || 0);
      calculatedTotal += finalPrice * (item.quantity || 1);
      return {
        product: extractedId,
        name: dbProduct?.name || item.name,
        price: finalPrice,
        quantity: item.quantity || 1,
        size: item.size,
        color: item.color,
        image: dbProduct?.image || item.image
      };
    });

    console.log(`✅ Server-side price calculation: KSh ${calculatedTotal} (items: ${orderItems.length})`);

    const order = await Order.create({
      user: userId, // Can be null for guest checkout
      userEmail: userEmail,
      items: orderItems,
      totalAmount: calculatedTotal,
      paymentMethod: normalizedPaymentMethod,
      shippingAddress: mappedShippingAddress,
      deliveryDate,
      convenientTime,
      status: 'pending',
      isPaid: false
    });

    // Create admin notification for new order
    try {
      await Notification.create({
        type: 'NEW_ORDER',
        message: `New order placed for KSh ${order.totalAmount}`,
        orderId: order._id
      });
      console.log('✅ Admin notification created for new order!');
    } catch (notifError) {
      console.error('⚠️ Error creating notification:', notifError.message);
    }

    // Send push notification to admins
    try {
      await sendPushNotificationToAdmins(
        'New Order!',
        `An order was just placed for KSh ${order.totalAmount}`
      );
    } catch (pushError) {
      console.error('⚠️ Error sending push notification:', pushError.message);
    }

    // Send confirmation email to customer (async - non-blocking)
    if (userEmail) {
      sendOrderConfirmationEmail(userEmail, order).catch(err => 
        console.error('⚠️ Error sending order confirmation email:', err.message)
      );
    }

    // Notify Admin of New Order (async - non-blocking)
    const adminMsg = `A new order (#${order._id}) totaling KES ${order.totalAmount} has just been placed! Log into the admin dashboard to process it.`;
    try {
      // First, try fetching from the dedicated Admin model
      let admins = [];
      try { admins = await Admin.find({}).select('email'); } catch(e) {}
      
      // If no dedicated admins, fallback to Users with admin role
      if (!admins || admins.length === 0) {
        admins = await User.find({ role: 'admin' }).select('email');
      }

      const adminEmails = admins.map(a => a.email).filter(Boolean);
      
      sendAdminNotification('🚨 New Order Received!', adminMsg, adminEmails).catch(err =>
        console.error('⚠️ Error sending admin notification email:', err.message)
      );
    } catch (adminErr) {
      console.error('⚠️ Error fetching admin users:', adminErr.message);
      sendAdminNotification('🚨 New Order Received!', adminMsg).catch(err =>
        console.error('⚠️ Error sending admin notification email:', err.message)
      );
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order
    });
  } catch (error) {
    console.error('❌ Mongoose Validation Failed:', error);
    // Send 400 Bad Request with the exact error message instead of crashing with 500
    return res.status(400).json({ success: false, message: error.message }); 
  }
};

// Get All Orders (Admin)
export const getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, status } = req.query;

    const query = {};
    
    if (search) {
      query.$or = [
        { userEmail: { $regex: search, $options: 'i' } },
        { paymentReference: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate('user', 'name email phone')
      .populate('items.product')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    res.status(200).json({
      success: true,
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
};

// Get Current User's Orders
export const getMyOrders = async (req, res) => {
  try {
    // JWT token contains userId, so we check all possible field names
    const userId = req.user?.userId || req.user?._id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Only fetch paid/completed orders - exclude pending/unpaid checkouts
    const orders = await Order.find({ 
      user: userId,
      isPaid: true,
      status: { $nin: ['pending', 'cancelled'] }
    })
      .populate('items.product')
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      orders
    });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order history'
    });
  }
};

// Get Single Order
export const getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('items.product');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.status(200).json({
      success: true,
      order
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order'
    });
  }
};

// Update Order Status & Fulfillment Details
export const updateOrderStatus = async (req, res) => {
  try {
    const { status, expectedArrival, deliveryDetails } = req.body;

    // Force the incoming status to lowercase
    const newStatus = status ? status.toLowerCase() : null;
    console.log("🔥 Attempting to update order to:", newStatus);

    // Build update object dynamically
    const updateData = {};
    if (newStatus) updateData.status = newStatus;
    if (expectedArrival !== undefined) updateData.expectedArrival = expectedArrival;
    if (deliveryDetails !== undefined) updateData.deliveryDetails = deliveryDetails;

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('user', 'name email phone');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Log action
    await SystemLog.create({
      action: 'order_updated',
      actor: req.admin?.email || 'system',
      actorType: 'admin',
      details: { orderId: order._id, status: newStatus },
      module: 'order'
    });

    // Send status update email to customer (async - non-blocking)
    const customerEmail = order.userEmail || order.user?.email;
    if (customerEmail && newStatus) {
      sendOrderStatusUpdateEmail(customerEmail, order, newStatus).catch(err =>
        console.error('⚠️ Error sending order status update email:', err.message)
      );
    }

    res.status(200).json({
      success: true,
      message: 'Order status updated',
      order
    });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order'
    });
  }
};

// Cancel Order
export const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Log action
    await SystemLog.create({
      action: 'order_cancelled',
      actor: req.admin?.email || 'system',
      actorType: 'admin',
      details: { orderId: order._id },
      module: 'order'
    });

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      order
    });
  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order'
    });
  }
};

// Delete Order (Admin only - permanent deletion)
export const deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Log action
    await SystemLog.create({
      action: 'order_deleted',
      actor: req.admin?.email || 'system',
      actorType: 'admin',
      details: { orderId: req.params.id },
      module: 'order'
    });

    res.status(200).json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete order'
    });
  }
};

