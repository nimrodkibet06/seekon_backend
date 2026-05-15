import Transaction from '../models/Transaction.js';
import Order from '../models/Order.js';
import Cart from '../models/Cart.js';
import Notification from '../models/Notification.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import crypto from 'crypto';
import axios from 'axios';

// Helper function to decrement inventory on successful payment
const decrementInventory = async (orderItems) => {
  try {
    for (const item of orderItems) {
      const productId = item.product || item.productId || item._id;
      if (productId) {
        // Decrement stock AND increment sold count
        const updatedProduct = await Product.findByIdAndUpdate(
          productId,
          { $inc: { stock: -item.quantity, sold: item.quantity } },
          { new: true } // Returns the document AFTER the update
        );

        if (updatedProduct) {
          // 1. If it hit 0, flip inStock to false and send Out of Stock Alert
          if (updatedProduct.stock <= 0) {
            await Product.findByIdAndUpdate(productId, { inStock: false });
            await Notification.create({
              type: 'SYSTEM',
              message: `🚨 OUT OF STOCK: ${updatedProduct.name} has sold out!`
            });
          }
          // 2. If it dropped below 10, send Low Stock Alert
          else if (updatedProduct.stock < 10) {
            await Notification.create({
              type: 'SYSTEM',
              message: `⚠️ LOW STOCK: ${updatedProduct.name} only has ${updatedProduct.stock} left.`
            });
          }
        }
      }
    }
    console.log('✅ Inventory decremented and notifications checked.');
  } catch (err) {
    console.error('⚠️ Error decrementing inventory:', err.message);
  }
};

// Paystack Payment Initialization
export const initializePaystackPayment = async (req, res) => {
  try {
    const { orderId, amount, email } = req.body;

    if (!orderId || !amount || !email) {
      return res.status(400).json({
        success: false,
        message: 'Order ID, amount, and email are required'
      });
    }

    // Verify order exists and get correct amount from database for security
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Generate unique reference
    const reference = `PAYSTACK_${orderId}_${Date.now()}`;

    // Paystack requires amount in kobo/cents (multiply by 100)
    const amountInCents = Math.round(amount * 100);

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: email,
        amount: amountInCents,
        currency: 'KES',
        reference: reference,
        callback_url: `${process.env.FRONTEND_URL}/order-success/${orderId}`,
        metadata: {
          order_id: orderId,
          user_email: email
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Save payment reference to order
    await Order.findByIdAndUpdate(orderId, {
      paymentReference: reference,
      paymentMethod: 'paystack'
    });

    // Send the checkout URL back to the frontend
    res.status(200).json({
      success: true,
      checkoutUrl: response.data.data.authorization_url,
      reference: reference
    });
  } catch (error) {
    console.error('Paystack Init Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Payment initialization failed'
    });
  }
};

// Paystack Payment Verification (called from frontend after callback)
export const verifyPaystackPayment = async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const paymentData = response.data.data;

    if (paymentData.status === 'success') {
      const orderId = paymentData.metadata?.order_id;
      const amountPaid = paymentData.amount / 100; // Convert back from cents to KES
      const customerEmail = paymentData.customer?.email;

      if (!orderId) {
        return res.status(400).json({
          success: false,
          message: 'Order ID missing from payment metadata'
        });
      }

      // Find order
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      // Check if order already paid to prevent double processing
      if (order.isPaid) {
        return res.status(200).json({
          success: true,
          message: 'Order already paid',
          alreadyPaid: true
        });
      }

      // Update order status
      order.isPaid = true;
      order.paidAt = new Date();
      order.paymentResult = {
        id: paymentData.transaction_id,
        status: 'Completed',
        email_address: customerEmail
      };
      order.status = 'processing';
      await order.save();

      // Create Transaction record
      await Transaction.create({
        userEmail: customerEmail || order.userEmail || 'unknown@seekon.com',
        phoneNumber: '',
        method: 'paystack',
        amount: amountPaid,
        status: 'completed',
        reference: reference,
        paystackResponse: paymentData,
        callbackData: paymentData
      });

      // Decrement inventory on successful payment
      await decrementInventory(order.items);

      // Clear user's cart
      if (order && order.user) {
        try {
          const userId = order.user;
          console.log(`🛒 Clearing cart for Paystack user: ${userId}`);
          await Cart.findOneAndUpdate(
            { userId: userId },
            { items: [], totalItems: 0, totalPrice: 0 }
          );
          console.log(`✅ Cart cleared for user ${userId}!`);
        } catch (cartError) {
          console.error('⚠️ Error clearing cart:', cartError.message);
        }
      } else {
        console.log('⚠️ No user associated with Paystack order, skipping cart clear');
      }

      // Create admin notification
      try {
        await Notification.create({
          type: 'NEW_ORDER',
          message: `Payment received! Order paid via Paystack: KSh ${amountPaid}`,
          orderId: order._id
        });
        console.log('✅ Admin notification created for paid order!');
      } catch (notifError) {
        console.error('⚠️ Error creating notification:', notifError.message);
      }

      res.status(200).json({
        success: true,
        message: 'Payment verified successfully',
        data: {
          orderId: orderId,
          amount: amountPaid,
          status: 'completed'
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        status: paymentData.status,
        gatewayResponse: paymentData
      });
    }
  } catch (error) {
    console.error('Paystack Verification Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Server error verifying payment'
    });
  }
};

// Flutterwave Payment Initialization (keep existing code)
const initFlutterwave = () => {
  const Flutterwave = require('flutterwave-node-v3').default;
  const publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    throw new Error('Flutterwave credentials not configured');
  }

  return new Flutterwave(publicKey, secretKey);
};

export const initiateFlutterwavePayment = async (req, res) => {
  try {
    const { amount, email, phone, orderId } = req.body;

    if (!amount || !email) {
      return res.status(400).json({
        success: false,
        message: 'Amount and email are required'
      });
    }

    const flw = initFlutterwave();

    const reference = `FW${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const payload = {
      tx_ref: reference,
      amount: amount.toString(),
      currency: 'KES',
      redirect_url: `${process.env.FRONTEND_URL || 'https://seekon.vercel.app'}/order-confirmation`,
      meta: {
        orderId,
        source: 'seekon-app'
      },
      customer: {
        email,
        phone_number: phone || '',
        name: email.split('@')[0]
      },
      customizations: {
        title: 'Seekon Apparel',
        logo: 'https://seekon.vercel.app/logo.png'
      }
    };

    const response = await flw.Payment.plan.create(payload);

    if (response.status === 'success') {
      // Create pending transaction
      await Transaction.create({
        userEmail: email,
        phoneNumber: phone || '',
        method: 'flutterwave',
        amount,
        status: 'pending',
        reference
      });

      res.status(200).json({
        success: true,
        message: 'Flutterwave payment initiated',
        data: {
          link: response.data.link,
          reference
        }
      });
    } else {
      throw new Error(response.message || 'Failed to initiate Flutterwave payment');
    }
  } catch (error) {
    console.error('❌ Flutterwave payment error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate Flutterwave payment'
    });
  }
};

// Flutterwave Callback
export const flutterwaveCallback = async (req, res) => {
  try {
    const { transaction_id, tx_ref, status } = req.query;

    console.log('🔔 Flutterwave callback received:', { transaction_id, tx_ref, status });

    if (status === 'successful') {
      const flw = initFlutterwave();
      const response = await flw.Transaction.verify({ id: transaction_id });

      if (response.status === 'success' && response.data.status === 'successful') {
        const amount = response.data.amount;
        const email = response.data.customer.email;

        // Update transaction
        await Transaction.findOneAndUpdate(
          { reference: tx_ref },
          {
            status: 'completed',
            callbackData: response.data
          }
        );

        // Update order
        const order = await Order.findOne({ paymentReference: tx_ref });
        if (order) {
          order.isPaid = true;
          order.paidAt = new Date();
          order.paymentResult = {
            id: transaction_id,
            status: 'Completed',
            email_address: email
          };
          order.status = 'processing';
          await order.save();

          // Decrement inventory on successful payment
          await decrementInventory(order.items);

          // Clear cart - use order.user from Order document, NOT req.user
          // Flutterwave webhooks do NOT send auth headers
          if (order && order.user) {
            try {
              const userId = order.user;
              console.log(`🛒 Clearing cart for Flutterwave user: ${userId}`);
              await Cart.findOneAndUpdate(
                { userId: userId },
                { items: [], totalItems: 0, totalPrice: 0 }
              );
              console.log(`✅ Flutterwave cart cleared for user ${userId}!`);
            } catch (cartError) {
              console.error('⚠️ Error clearing Flutterwave cart:', cartError.message);
            }
          } else {
            console.log('⚠️ No user associated with Flutterwave order, skipping cart clear');
          }

          // Create notification
          await Notification.create({
            type: 'NEW_ORDER',
            message: `Payment received! Order paid: KSh ${amount}`,
            orderId: order._id
          });
        }

        res.redirect(`${process.env.FRONTEND_URL || 'https://seekon.vercel.app'}/order-confirmation?success=true&tx_ref=${tx_ref}`);
      } else {
        res.redirect(`${process.env.FRONTEND_URL || 'https://seekon.vercel.app'}/order-confirmation?success=false&tx_ref=${tx_ref}`);
      }
    } else {
      res.redirect(`${process.env.FRONTEND_URL || 'https://seekon.vercel.app'}/order-confirmation?success=false&tx_ref=${tx_ref}`);
    }
  } catch (error) {
    console.error('❌ Flutterwave callback error:', error.message);
    res.redirect(`${process.env.FRONTEND_URL || 'https://seekon.vercel.app'}/order-confirmation?success=false`);
  }
};

// Get user transactions
export const getUserTransactions = async (req, res) => {
  try {
    const { userEmail } = req.params;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User email is required'
      });
    }

    const transactions = await Transaction.find({ userEmail })
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      success: true,
      transactions
    });
  } catch (error) {
    console.error('❌ Error fetching user transactions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions'
    });
  }
};
