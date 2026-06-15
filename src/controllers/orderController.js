import crypto from 'crypto';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import SystemLog from '../models/SystemLog.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import disposableDomains from 'disposable-email-blocklist';

import axios from 'axios';

/**
 * Helper to check if email is disposable (Two-tiered defense)
 */
const isEmailDisposable = async (email) => {
  if (!email) return false;
  
  // TIER 1: Local Static Check (Fast, No Cost)
  const domain = email.split('@')[1].toLowerCase();
  if (disposableDomains.includes(domain)) {
    return true;
  }

  // TIER 2: Live API Check (Abstract API)
  // Strict Fail-Safe: If API fails or key is missing, return false to let user through
  try {
    const apiKey = process.env.ABSTRACT_EMAIL_API_KEY;
    if (!apiKey || apiKey === 'your_abstract_api_key') {
      console.warn('⚠️ ABSTRACT_EMAIL_API_KEY is missing or using placeholder. Skipping Tier 2 email check.');
      return false;
    }

    const response = await axios.get(`https://emailvalidation.abstractapi.com/v1/?api_key=${apiKey}&email=${email}`, {
      timeout: 2000 // Strict 2 second timeout
    });

    if (response.data?.is_disposable_email?.value === true) {
      console.log(`🚫 Blocked disposable email via Abstract API (Order): ${email}`);
      return true;
    }

    return false;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('❌ Abstract API 401 Unauthorized: Your API key is invalid or has expired. Please check ABSTRACT_EMAIL_API_KEY in .env');
    } else {
      console.error('❌ Tier 2 Email Check Error (Order):', error.message);
    }
    return false; // Fail-safe: allow order if API is down or unauthorized
  }
};
import { sendPushNotificationToAdmins } from '../routes/notificationRoutes.js';
import { sendOrderConfirmationEmail, sendOrderStatusUpdateEmail, sendAdminNotification } from '../utils/email.js';
import whatsappClient, { sendSafeMessage, getAdminChat } from '../config/whatsapp.js';

// Create Order
export const createOrder = async (req, res) => {
  try {
    console.log("🔥 INCOMING ORDER REQUEST BODY:", JSON.stringify(req.body, null, 2));
    console.log("👤 AUTH USER:", JSON.stringify(req.user, null, 2));

    const {
      items,
      paymentMethod,
      shippingAddress,
      deliveryDate,
      convenientTime,
      contactEmail: bodyContactEmail,
      email: bodyEmail,
      shippingPrice,
      shippingMethod
    } = req.body;

    const contactEmail = (bodyContactEmail || bodyEmail || req.user?.email || shippingAddress?.email || '')
      .trim()
      .toLowerCase();

    if (!contactEmail) {
      return res.status(400).json({
        success: false,
        message: 'contactEmail is required to place an order'
      });
    }

    // SECURITY: Block disposable emails (Tiered Defense)
    if (await isEmailDisposable(contactEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Orders from temporary/disposable email addresses are not allowed. Please use a permanent email address.'
      });
    }

    // GUEST CHECKOUT LOGIC: If no authenticated user, handle as guest
    const userId = req.user?.userId || req.user?._id || req.user?.id;
    const isGuestCheckout = !userId;
    const userEmail = userId ? req.user.email : contactEmail;
    
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
      user: userId || undefined,
      isGuestCheckout,
      guestEmail: isGuestCheckout ? contactEmail : undefined,
      guestPhone: isGuestCheckout ? (shippingAddress?.phone || '') : undefined,
      contactEmail,
      userEmail,
      items: orderItems,
      totalAmount: calculatedTotal + (shippingPrice || 0),
      paymentMethod: normalizedPaymentMethod,
      shippingAddress: mappedShippingAddress,
      deliveryDate: deliveryDate,
      convenientTime,
      shippingPrice: shippingPrice || 0,
      shippingMethod: shippingMethod || '',
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

    // Start Asynchronous, Non-Blocking Email and WhatsApp Pipeline
    (async () => {
      // 1. Dispatch Customer Order Receipt Email Immediately
      if (userEmail) {
        try {
          await sendOrderConfirmationEmail(userEmail, order);
          console.log('✅ World-class luxury order confirmation email sent to customer.');
        } catch (emailErr) {
          console.error('⚠️ Error sending customer order confirmation email:', emailErr.message);
        }
      }

      // Also send Admin Notification Email
      const adminMsg = `A new order (#${order._id}) totaling KES ${order.totalAmount} has just been placed! Log into the admin dashboard to process it.`;
      try {
        let admins = [];
        try { admins = await Admin.find({}).select('email'); } catch(e) {}
        if (!admins || admins.length === 0) {
          admins = await User.find({ role: 'admin' }).select('email');
        }
        const adminEmails = admins.map(a => a.email).filter(Boolean);
        await sendAdminNotification('🚨 New Order Received!', adminMsg, adminEmails);
      } catch (adminErr) {
        console.error('⚠️ Error fetching admins or sending admin notification:', adminErr.message);
        try {
          await sendAdminNotification('🚨 New Order Received!', adminMsg);
        } catch (e) {}
      }

      // 2. Non-blocking WhatsApp Pipeline
      try {
        const phone = order.shippingAddress?.phone || order.guestPhone;
        if (!phone) {
          console.log('⚠️ No phone number available for WhatsApp notification routing.');
          return;
        }

        // Clean & format the phone number
        let formattedPhone = phone.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
          formattedPhone = '254' + formattedPhone.substring(1);
        } else if (!formattedPhone.startsWith('254') && formattedPhone.length === 9) {
          formattedPhone = '254' + formattedPhone;
        }

        console.log(`📱 Routing WhatsApp customer confirmation message directly...`);
        const customerName = `${order.shippingAddress?.firstName || ''} ${order.shippingAddress?.lastName || ''}`.trim() || order.shippingAddress?.name || 'Customer';
        const subtotal = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalWithShipping = order.totalAmount;
        const formattedDate = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const itemsList = order.items.map(item => {
          const specs = [
            item.size ? `Size: ${item.size}` : '',
            item.color ? `Color: ${item.color}` : ''
          ].filter(Boolean).join(', ');
          const specStr = specs ? ` (${specs})` : '';
          return `• *${item.name}* x${item.quantity}${specStr}\n  _KSh ${(item.price * item.quantity).toLocaleString()}_`;
        }).join('\n\n');

        const customerMsg = `⚜️ *SEEKON APPAREL* ⚜️
_Premium Order Confirmation_

*Thank you for your order, ${customerName}!*
Your order has been received and is being prepared for dispatch.

🔸 *ORDER DETAILS*
• *Order ID:* \`${order._id}\`
• *Date:* ${formattedDate}
• *Payment:* ${order.paymentMethod || 'M-Pesa'}

🔸 *ITEMS ORDERED*
${itemsList}

🔸 *SHIPPING & DELIVERY*
• *Recipient:* ${customerName}
• *Phone:* ${phone}
• *Address:* ${order.shippingAddress?.address || 'N/A'}
• *Method:* ${order.shippingMethod || 'Standard'}

🔸 *TOTAL AMOUNT*
• *Subtotal:* KSh ${subtotal.toLocaleString()}
• *Shipping:* KSh ${(order.shippingPrice || 0).toLocaleString()}
• *Total Paid:* *KSh ${totalWithShipping.toLocaleString()}* 👑

✨ *What's Next?*
We will notify you here once your package has been handed over to the courier with your tracking details.

For support or modifications, please reply directly to this chat.`;
        
        let sentCustomerMsg = false;
        try {
          await sendSafeMessage(whatsappClient, phone, customerMsg);
          sentCustomerMsg = true;
        } catch (msgErr) {
          console.error('⚠️ Failed to send WhatsApp customer confirmation:', msgErr.message);
        }

        const adminChat = await getAdminChat(whatsappClient);
        const adminAlertMsg = `⚠️ *SEEKON BOT ALERT* ⚠️
_Customer WhatsApp Unreachable_

• *Order ID:* \`${order._id}\`
• *Customer:* ${customerName}
• *Phone:* ${phone}

🔸 *Action Taken:*
- Fallback confirmation email sent to *${userEmail || contactEmail}*.
- Order status marked with pending alerts.

🔸 *Troubleshooting:*
Please verify if the customer number *${phone}* is active on WhatsApp, or check server logs.`;

        if (!sentCustomerMsg) {
          console.log('❌ WhatsApp customer message failed. Appending status to database and alerting admin...');
          
          // Append status to database (order.notes)
          const updatedNotes = order.notes 
            ? `${order.notes}\nPending - WhatsApp Delivery Failed` 
            : 'Pending - WhatsApp Delivery Failed';
          await Order.findByIdAndUpdate(order._id, { notes: updatedNotes });

          // Alert Admin WhatsApp Group Chat or fallback to direct message
          if (adminChat) {
            await adminChat.sendMessage(adminAlertMsg);
          } else {
            try {
              await sendSafeMessage(whatsappClient, 'me', adminAlertMsg);
            } catch (dmErr) {
              console.warn('⚠️ Fallback admin alert DM to self failed:', dmErr.message);
            }
          }
        } else {
          console.log('✅ WhatsApp customer message sent. Routing admin summary...');
          const adminSummaryMsg = `👑 *SEEKON ADMIN DISPATCH* 👑
_New Premium Order Alert_

🔸 *ORDER INFO*
• *Order ID:* \`${order._id}\`
• *Date:* ${formattedDate}
• *Payment:* ${order.paymentMethod || 'M-Pesa'}

🔸 *CUSTOMER DETAILS*
• *Name:* ${customerName}
• *Email:* ${userEmail || contactEmail}
• *Phone:* ${phone}

🔸 *SHIPPING INFO*
• *Address:* ${order.shippingAddress?.address || 'N/A'}
• *Method:* ${order.shippingMethod || 'Standard'}

🔸 *ITEMS ORDERED*
${itemsList}

🔸 *FINANCIALS*
• *Subtotal:* KSh ${subtotal.toLocaleString()}
• *Shipping:* KSh ${(order.shippingPrice || 0).toLocaleString()}
• *Total Amount:* *KSh ${totalWithShipping.toLocaleString()}* 💰

✨ *Status:* Pending Dispatch
Action required: Verify payment and update order status to shipped once dispatched.`;

          // Structured summary to Admin WhatsApp Group Chat or fallback to direct message
          if (adminChat) {
            await adminChat.sendMessage(adminSummaryMsg);
          } else {
            try {
              await sendSafeMessage(whatsappClient, 'me', adminSummaryMsg);
            } catch (dmErr) {
              console.warn('⚠️ Fallback admin summary DM to self failed:', dmErr.message);
            }
          }
        }
      } catch (waErr) {
        console.error('⚠️ Non-blocking WhatsApp operations failed:', waErr.message);
      }
    })();

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
        { contactEmail: { $regex: search, $options: 'i' } },
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

    // Return all orders where user matches and hiddenByUser is false (or not set)
    const query = { 
      user: userId,
      hiddenByUser: { $ne: true }
    };

    const orders = await Order.find(query)
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

// Clear User Order History (Bulk Update approach)
export const clearUserOrderHistory = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Mark existing completed/finalized orders as hidden
    await Order.updateMany(
      { 
        user: userId, 
        status: { $in: ['delivered', 'completed', 'cancelled', 'failed'] } 
      }, 
      { $set: { hiddenByUser: true } }
    );

    res.status(200).json({
      success: true,
      message: 'Order history cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing order history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear order history'
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
    const customerEmail = order.contactEmail || order.userEmail || order.user?.email;
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

