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
        // Decrement stock and get the updated product back
        const updatedProduct = await Product.findByIdAndUpdate(
          productId,
          { $inc: { stock: -item.quantity } },
          { new: true } // Crucial: returns the document AFTER the decrement
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

// M-Pesa OAuth token (Production API)
const getMpesaAccessToken = async () => {
  try {
    const consumerKey = process.env.CONSUMER_KEY || process.env.DARAJA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.CONSUMER_SECRET || process.env.DARAJA_CONSUMER_SECRET || process.env.MPESA_CONSUMER_SECRET;
    
    if (!consumerKey || !consumerSecret) {
      const error = new Error('M-Pesa credentials not configured. Please add CONSUMER_KEY and CONSUMER_SECRET to Railway environment variables.');
      error.code = 'MPESA_NOT_CONFIGURED';
      throw error;
    }

    // Check environment - use sandbox or production
    const isSandbox = process.env.MPESA_ENVIRONMENT === 'sandbox';
    const baseUrl = isSandbox 
      ? 'https://sandbox.safaricom.co.ke' 
      : 'https://api.safaricom.co.ke';

    console.log(isSandbox ? '🔐 Getting M-Pesa access token from SANDBOX API...' : '🔐 Getting M-Pesa access token from PRODUCTION API...');
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    // Use appropriate API endpoint based on environment
    const response = await axios.get(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });

    console.log('✅ M-Pesa access token retrieved successfully');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Error getting M-Pesa access token:', error.response?.data || error.message);
    throw error;
  }
};

// Generate password for M-Pesa
const generatePassword = () => {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
  const shortcode = process.env.SHORTCODE || process.env.DARAJA_BUSINESS_SHORTCODE || process.env.MPESA_SHORTCODE;
  const passkey = process.env.PASSKEY || process.env.DARAJA_PASS_KEY || process.env.MPESA_PASSKEY;
  
  // Default sandbox passkey for testing
  const defaultPasskey = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
  const finalPasskey = process.env.MPESA_ENVIRONMENT === 'sandbox' ? defaultPasskey : passkey;

  if (!shortcode) {
    throw new Error('M-Pesa shortcode not configured. Please add SHORTCODE to .env');
  }

  if (!finalPasskey) {
    throw new Error('M-Pesa passkey not configured. Please add PASSKEY to .env');
  }

  const password = Buffer.from(`${shortcode}${finalPasskey}${timestamp}`).toString('base64');
  
  // DEBUG: Log the generated password with masked middle part
  const maskedPassword = password.substring(0, 10) + '...' + password.substring(password.length - 10);
  console.log(`🔐 DEBUG M-Pesa Password Generation:`);
  console.log(`   Shortcode: ${shortcode}`);
  console.log(`   Timestamp: ${timestamp}`);
  console.log(`   Passkey: ${finalPasskey.substring(0, 5)}...${finalPasskey.substring(finalPasskey.length - 5)}`);
  console.log(`   Generated Password: ${maskedPassword}`);
  console.log(`   Full Base64 Length: ${password.length}`);
  
  return { password, timestamp };
};

// M-Pesa STK Push
export const initiateMpesaPayment = async (req, res) => {
  try {
    // Extract raw values from request body
    const rawPhone = req.body.phone || req.body.phoneNumber;
    let rawAmount = req.body.amount;
    const { userEmail, orderId } = req.body;

    console.log('📥 Received payment request:', { rawPhone, rawAmount, userEmail, orderId });

    if (!rawPhone || !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and email are required'
      });
    }

    // SECURITY: Recalculate total from database if orderId is provided
    // This ensures the amount cannot be manipulated from the frontend
    if (orderId) {
      try {
        const order = await Order.findById(orderId);
        if (order) {
          // Validate order items have valid product IDs
          order.items.forEach((item, index) => {
            const prodId = item.product?._id || item.product || item.productId;
            if (!prodId) {
              console.error(`🚨 Item at index ${index} is missing a Product ID! Item:`, item.name);
            }
          });
          
          // Recalculate total from order items stored in database
          const calculatedTotal = order.items.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
          }, 0);
          rawAmount = calculatedTotal;
          console.log('🔒 Recalculated total from database:', rawAmount);
        }
      } catch (calcError) {
        console.error('⚠️ Error recalculating order total:', calcError.message);
        // Fall back to frontend amount if calculation fails
      }
    }

    // COUPON: Validate and apply coupon if provided
    let couponDiscount = 0;
    const { couponCode } = req.body;
    if (couponCode && rawAmount > 0) {
      try {
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
        
        if (coupon) {
          // Validate coupon
          if (!coupon.isActive) {
            console.log('⚠️ Coupon is inactive:', couponCode);
          } else if (new Date(coupon.expiryDate) < new Date()) {
            console.log('⚠️ Coupon has expired:', couponCode);
          } else if (coupon.usedCount >= coupon.usageLimit) {
            console.log('⚠️ Coupon usage limit reached:', couponCode);
          } else {
            // Calculate discount
            if (coupon.discountType === 'percentage') {
              couponDiscount = (rawAmount * coupon.discountValue) / 100;
              if (coupon.maxDiscountAmount && couponDiscount > coupon.maxDiscountAmount) {
                couponDiscount = coupon.maxDiscountAmount;
              }
            } else {
              couponDiscount = coupon.discountValue;
              if (couponDiscount > rawAmount) {
                couponDiscount = rawAmount;
              }
            }
            console.log('🎟️ Coupon applied:', couponCode, 'Discount:', couponDiscount);
          }
        } else {
          console.log('⚠️ Coupon not found:', couponCode);
        }
      } catch (couponError) {
        console.error('⚠️ Error validating coupon:', couponError.message);
      }
    }

    // Apply discount
    rawAmount = rawAmount - couponDiscount;
    console.log('🔒 Final amount after discount:', rawAmount);

    if (!rawAmount) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required'
      });
    }

    // 1. Format Phone Number: Strip all non-numeric characters (removes the '+')
    let formattedPhone = rawPhone.replace(/\D/g, '');
    
    // If it starts with '0', replace '0' with '254'
    if (formattedPhone.startsWith('0')) {
      formattedPhone = `254${formattedPhone.substring(1)}`;
    }
    
    console.log(`📱 Cleaned Phone: ${formattedPhone}`);

    if (!formattedPhone.startsWith('254')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Kenyan phone number format'
      });
    }

    // 2. Format Amount: Safaricom requires strict integers
    const finalAmount = Math.round(Number(rawAmount));
    console.log(`💰 Cleaned Amount: ${finalAmount}`);

    // Generate reference - will be used to create Transaction upon successful payment
    const reference = `MPESA${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // 3. Get order items for transaction description (if orderId provided)
    let itemNames = 'Seekon Purchase';
    if (orderId) {
      try {
        const order = await Order.findById(orderId);
        if (order && order.items && order.items.length > 0) {
          // Create a summary string from item names
          const names = order.items.map(i => i.name).filter(n => n);
          if (names.length > 0) {
            itemNames = names.join(', ');
            // Truncate to 30 chars max for M-Pesa
            if (itemNames.length > 30) {
              itemNames = itemNames.substring(0, 27) + '...';
            }
          }
        }
      } catch (orderError) {
        console.error('⚠️ Error fetching order for transaction desc:', orderError.message);
      }
    }

    // Check if credentials are set up
    const hasCredentials = 
      (process.env.CONSUMER_KEY || process.env.DARAJA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY) &&
      (process.env.CONSUMER_SECRET || process.env.DARAJA_CONSUMER_SECRET || process.env.MPESA_CONSUMER_SECRET) &&
      (process.env.SHORTCODE || process.env.DARAJA_BUSINESS_SHORTCODE || process.env.MPESA_SHORTCODE);

    // Determine environment and base URL
    const isSandbox = process.env.MPESA_ENVIRONMENT === 'sandbox';

    if (!hasCredentials) {
      console.log('⚠️ M-Pesa credentials not configured. Running in mock mode.');
      return res.status(200).json({
        success: true,
        message: 'Mock: STK Push would be sent. Please configure M-Pesa credentials in .env file.',
        mock: true,
        data: {
          reference,
          checkoutRequestID: 'MOCK_CHECKOUT_123'
        }
      });
    }

    // Get access token
    const accessToken = await getMpesaAccessToken();

    // Generate password
    const { password, timestamp } = generatePassword();

    // STK Push request
    const shortcode = process.env.SHORTCODE || process.env.DARAJA_BUSINESS_SHORTCODE || process.env.MPESA_SHORTCODE;
    
    // PRODUCTION: Use Railway callback URL
    const CallBackURL = 'https://seekonbackend-production.up.railway.app/api/payment/mpesa-callback';
    console.log('🎯 Using CallBackURL:', CallBackURL);

    // Determine base URL based on environment
    const stkPushUrl = isSandbox
      ? 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    // For sandbox testing, force amount to 1
    const amountForSTK = isSandbox ? 1 : finalAmount;

    const stkPushData = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amountForSTK,
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: CallBackURL,
      AccountReference: reference,
      TransactionDesc: `Pay for: ${itemNames}`
    };

    console.log('🚀 Payload being sent to Safaricom:', JSON.stringify(stkPushData, null, 2));

    console.log('📤 Sending STK Push request:', {
      phone: formattedPhone,
      amount: amountForSTK,
      reference,
      callbackURL: CallBackURL,
      environment: isSandbox ? 'sandbox' : 'production'
    });

    console.log(isSandbox ? '📤 Sending STK Push to SANDBOX API...' : '📤 Sending STK Push to PRODUCTION API...');
    const response = await axios.post(
      stkPushUrl,
      stkPushData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ STK Push response:', response.data);

    // If orderId is provided, save the CheckoutRequestID to the order
    if (orderId && response.data.CheckoutRequestID) {
      try {
        await Order.findByIdAndUpdate(orderId, {
          mpesaCheckoutRequestId: response.data.CheckoutRequestID,
          paymentReference: reference
        });
        console.log(`✅ Saved CheckoutRequestID ${response.data.CheckoutRequestID} to order ${orderId}`);
      } catch (orderError) {
        console.error('⚠️ Error saving CheckoutRequestID to order:', orderError.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'STK Push sent. Please complete the payment on your phone.',
      data: {
        reference,
        checkoutRequestID: response.data.CheckoutRequestID
      }
    });
  } catch (error) {
    console.error('🚨 FATAL M-PESA CRASH CAUGHT:', error.stack || error);
    
    // Check for specific error codes to return more helpful messages
    if (error.code === 'MPESA_NOT_CONFIGURED') {
      return res.status(503).json({ 
        success: false, 
        message: 'M-Pesa payment is not configured on the server. Please contact support.' 
      });
    }
    
    // Force a 400 Bad Request instead of a 500 crash, so the frontend gets the exact reason
    return res.status(400).json({ 
      success: false, 
      message: `Checkout Error: ${error.message}` 
    });
  }
};

// M-Pesa Callback
export const mpesaCallback = async (req, res) => {
  console.log("🔥 ALERT: DARAJA CALLBACK HIT THE SERVER!");
  console.log("📦 RAW PAYLOAD:", JSON.stringify(req.body, null, 2));
  console.log("📋 HEADERS:", JSON.stringify(req.headers, null, 2));
  try {
    const callbackData = req.body;
    console.log('📥 M-Pesa Callback Received:', JSON.stringify(callbackData));

    if (callbackData.Body?.stkCallback) {
      const callback = callbackData.Body.stkCallback;
      const resultCode = callback.ResultCode;
      const checkoutRequestID = callback.CheckoutRequestID;

      if (resultCode === 0) {
        // Payment successful - extract metadata
        const meta = callback.CallbackMetadata?.Item || [];
        const amountPaid = meta.find(item => item.Name === 'Amount')?.Value;
        const mpesaReceipt = meta.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
        const phoneNumber = meta.find(item => item.Name === 'PhoneNumber')?.Value;
        
        console.log(`✅ Payment SUCCESS! Receipt: ${mpesaReceipt}, Amount: ${amountPaid}, Phone: ${phoneNumber}`);
        
        // Find the order first to get user info
        let order = null;
        try {
          order = await Order.findOne({ mpesaCheckoutRequestId: checkoutRequestID });
          if (order) {
            console.log(`📋 Order found: ${order._id}, saving M-Pesa receipt: ${mpesaReceipt}`);
          }
        } catch (orderError) {
          console.error('⚠️ Error finding order:', orderError.message);
        }

        // Get userEmail from order or use phone number as fallback
        const userEmail = order?.userEmail || (phoneNumber ? `${phoneNumber}@mpesa.com` : 'unknown@seekon.com');

        // Create Transaction ONLY when payment succeeds
        try {
          await Transaction.create({
            userEmail,
            phoneNumber: phoneNumber || '',
            method: 'mpesa',
            amount: amountPaid || 0,
            status: 'completed',
            reference: mpesaReceipt || order?.paymentReference || checkoutRequestID,
            mpesaResponse: callback,
            callbackData: callback
          });
          console.log('✅ Transaction created for successful payment!');
        } catch (transError) {
          console.error('⚠️ Error creating transaction:', transError.message);
        }

        // Update the order if it exists
        if (order) {
          try {
            order.isPaid = true;
            order.paidAt = new Date();
            order.paymentResult = {
              id: mpesaReceipt,
              status: 'Completed',
              email_address: phoneNumber
            };
            order.status = 'processing';
            await order.save();
            console.log(`✅ Order ${order._id} marked as paid!`);

            // Decrement inventory on successful payment
            await decrementInventory(order.items);

            // Clear the user's cart ONLY when payment succeeds
            // CRITICAL: Use order.user from the Order document, NOT req.user
            // Safaricom webhooks do NOT send auth headers
            if (order && order.user) {
              try {
                const userId = order.user;
                console.log(`🛒 Clearing cart for user: ${userId}`);
                await Cart.findOneAndUpdate(
                  { userId: userId },
                  { items: [], totalItems: 0, totalPrice: 0 }
                );
                console.log(`✅ Cart cleared for user ${userId}!`);
              } catch (cartError) {
                console.error('⚠️ Error clearing cart:', cartError.message);
              }
            } else {
              console.log('⚠️ No user associated with order, skipping cart clear');
            }
            
            // Create admin notification for paid order
            try {
              await Notification.create({
                type: 'NEW_ORDER',
                message: `Payment received! Order paid: KSh ${amountPaid || order.totalAmount}`,
                orderId: order._id
              });
              console.log('✅ Admin notification created for paid order!');
            } catch (notifError) {
              console.error('⚠️ Error creating notification:', notifError.message);
            }
          } catch (orderError) {
            console.error('⚠️ Error updating order:', orderError.message);
          }
        }
      } else {
        // Payment failed - do NOT create a Transaction document
        console.log(`❌ Payment FAILED: ${callback.ResultDesc} (Code: ${resultCode})`);

        // Update order status to cancelled
        try {
          const order = await Order.findOne({ mpesaCheckoutRequestId: checkoutRequestID });
          if (order) {
            order.status = 'cancelled';
            await order.save();
            console.log(`❌ Order ${order._id} marked as cancelled!`);
          }
        } catch (orderError) {
          console.error('⚠️ Error updating order:', orderError.message);
        }
      }
    }

    // Always respond with 200 OK so Safaricom knows we received it
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('❌ M-Pesa callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Callback processing failed'
    });
  }
};

// M-Pesa STK Push Query - Fallback to check transaction status
const processMpesaResult = async (resultCode, checkoutRequestID, amount, mpesaReceipt, phoneNumber) => {
  if (resultCode === 0 || resultCode === '0') {
    // Payment successful - create transaction
    try {
      // Find the order first to get user info
      const order = await Order.findOne({ mpesaCheckoutRequestId: checkoutRequestID });
      const userEmail = order?.userEmail || (phoneNumber ? `${phoneNumber}@mpesa.com` : 'unknown@seekon.com');

      await Transaction.create({
        userEmail,
        phoneNumber: phoneNumber || '',
        method: 'mpesa',
        amount: amount || 0,
        status: 'completed',
        reference: mpesaReceipt || order?.paymentReference || checkoutRequestID,
        callbackData: { ResultCode: resultCode, ResultDesc: 'Success via query' }
      });
      console.log('✅ Transaction created via query for successful payment!');
    } catch (transError) {
      console.error('⚠️ Error creating transaction:', transError.message);
    }

    // Also update the order if it exists
    try {
      const order = await Order.findOne({ mpesaCheckoutRequestId: checkoutRequestID });
      if (order) {
        order.isPaid = true;
        order.paidAt = new Date();
        order.paymentResult = {
          id: mpesaReceipt,
          status: 'Completed',
          email_address: phoneNumber
        };
        order.status = 'processing';
        await order.save();
        console.log(`✅ Order ${order._id} marked as paid via query!`);
        
        // Decrement inventory on successful payment
        await decrementInventory(order.items);
        
        // Clear the user's cart ONLY when payment succeeds
        // CRITICAL: Use order.user from the Order document, NOT req.user
        // Safaricom webhooks do NOT send auth headers
        if (order && order.user) {
          try {
            const userId = order.user;
            console.log(`🛒 Clearing cart for user via query: ${userId}`);
            await Cart.findOneAndUpdate(
              { userId: userId },
              { items: [], totalItems: 0, totalPrice: 0 }
            );
            console.log(`✅ Cart cleared for user ${userId} via query!`);
          } catch (cartError) {
            console.error('⚠️ Error clearing cart:', cartError.message);
          }
        } else {
          console.log('⚠️ No user associated with order, skipping cart clear');
        }
        
        // Create admin notification for paid order
        try {
          await Notification.create({
            type: 'NEW_ORDER',
            message: `Payment received! Order paid: KSh ${amount || order.totalAmount}`,
            orderId: order._id
          });
          console.log('✅ Admin notification created for paid order via query!');
        } catch (notifError) {
          console.error('⚠️ Error creating notification:', notifError.message);
        }
      }
    } catch (orderError) {
      console.error('⚠️ Error updating order:', orderError.message);
    }
    return true;
  } else {
    // Payment failed - do NOT create a Transaction document
    console.log(`❌ Query: Payment FAILED (Code: ${resultCode})`);

    // Update order status to cancelled
    try {
      const order = await Order.findOne({ mpesaCheckoutRequestId: checkoutRequestID });
      if (order) {
        order.status = 'cancelled';
        await order.save();
        console.log(`❌ Order ${order._id} marked as cancelled via query!`);
      }
    } catch (orderError) {
      console.error('⚠️ Error updating order:', orderError.message);
    }
    return false;
  }
};

// M-Pesa STK Push Query API
export const queryMpesaTransaction = async (req, res) => {
  try {
    const { checkoutRequestId, orderId } = req.body;

    if (!checkoutRequestId) {
      return res.status(400).json({
        success: false,
        message: 'CheckoutRequestID is required'
      });
    }

    console.log('🔍 Querying M-Pesa transaction:', { checkoutRequestId, orderId });

    // Check if credentials are set up
    const hasCredentials = 
      (process.env.CONSUMER_KEY || process.env.DARAJA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY) &&
      (process.env.CONSUMER_SECRET || process.env.DARAJA_CONSUMER_SECRET || process.env.MPESA_CONSUMER_SECRET) &&
      (process.env.SHORTCODE || process.env.DARAJA_BUSINESS_SHORTCODE || process.env.MPESA_SHORTCODE);

    if (!hasCredentials) {
      return res.status(400).json({
        success: false,
        message: 'M-Pesa credentials not configured'
      });
    }

    // Get access token
    const accessToken = await getMpesaAccessToken();

    // Generate password
    const { password, timestamp } = generatePassword();

    // Determine environment and base URL
    const isSandbox = process.env.MPESA_ENVIRONMENT === 'sandbox';
    const shortcode = process.env.SHORTCODE || process.env.DARAJA_BUSINESS_SHORTCODE || process.env.MPESA_SHORTCODE;

    // STK Query request
    const queryUrl = isSandbox
      ? 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query'
      : 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query';

    const queryData = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    };

    console.log('🔍 Sending STK Query request:', queryData);

    const response = await axios.post(
      queryUrl,
      queryData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('📥 STK Query response:', response.data);

    const resultCode = response.data.ResultCode;
    let amount = null;
    let mpesaReceipt = null;
    let phoneNumber = null;

    // Extract metadata if payment was successful
    if (response.data.CallbackMetadata) {
      const meta = response.data.CallbackMetadata.Item || [];
      amount = meta.find(item => item.Name === 'Amount')?.Value;
      mpesaReceipt = meta.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
      phoneNumber = meta.find(item => item.Name === 'PhoneNumber')?.Value;
    }

    // Process the result
    await processMpesaResult(resultCode, checkoutRequestId, amount, mpesaReceipt, phoneNumber);

    // Return appropriate response
    if (resultCode === 0 || resultCode === '0') {
      res.status(200).json({
        success: true,
        message: 'Payment successful',
        data: {
          status: 'completed',
          mpesaReceipt,
          amount,
          phoneNumber
        }
      });
    } else {
      res.status(200).json({
        success: false,
        message: response.data.ResultDesc || 'Payment failed or still pending',
        data: {
          status: 'failed',
          resultCode
        }
      });
    }
  } catch (error) {
    console.error('❌ M-Pesa query error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.errorMessage || error.message || 'Failed to query M-Pesa transaction'
    });
  }
};

// Initialize Flutterwave
const initFlutterwave = () => {
  const publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  
  if (!publicKey || !secretKey) {
    throw new Error('Flutterwave credentials not configured');
  }
  
  return new Flutterwave(publicKey, secretKey);
};

// Initiate Flutterwave Payment
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
