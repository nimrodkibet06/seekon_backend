import Order from '../models/Order.js';
import SystemLog from '../models/SystemLog.js';
import Notification from '../models/Notification.js';

// Create Order
export const createOrder = async (req, res) => {
  try {
    // Log the incoming payload to see what frontend actually sent
    console.log("🔥 INCOMING ORDER REQUEST BODY:", JSON.stringify(req.body, null, 2));
    console.log("👤 AUTH USER:", JSON.stringify(req.user, null, 2));
    
    const {
      items,
      totalAmount,
      paymentMethod,
      shippingAddress,
      deliveryDate,
      convenientTime
    } = req.body;

    // Get user from auth middleware - MUST exist since route is protected
    const userId = req.user?._id || req.user?.userId || req.user?.id;
    const userEmail = req.user?.email;
    
    // CRITICAL: Do NOT allow guest checkout if authenticated
    if (!userId || !userEmail) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in to place an order.'
      });
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

    // CRITICAL FIX: Map productId from cart to product in order with aggressive logging
    // Cart items use productId, Order uses product
    console.log("🛒 BEFORE MAPPING - Raw Cart Items:", JSON.stringify(items));
    
    // Validate that we have items
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No order items found'
      });
    }
    
    // Ensure every single item in the loop gets its product ID attached
    const orderItems = items.map(item => {
      // Aggressively grab the ID whether it's populated or raw
      const extractedId = item.product?._id || item.product || item.productId?._id || item.productId || item.id || item._id;
      
      if (!extractedId) {
        console.error("🚨 FATAL MAPPING ERROR: Missing ID for item:", item.name);
      }
      
      return {
        product: extractedId, // THE FIX - ensure we always have an ID
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
        image: item.image
      };
    });
    
    console.log("✅ AFTER MAPPING - Order Items to Save:", JSON.stringify(orderItems));

    const order = await Order.create({
      user: userId, // Can be null for guest checkout
      userEmail: userEmail,
      items: orderItems,
      totalAmount: totalAmount || 0,
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

