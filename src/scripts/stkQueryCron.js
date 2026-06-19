import cron from 'node-cron';
import Order from '../models/Order.js';
import Transaction from '../models/Transaction.js';
import Cart from '../models/Cart.js';
import Notification from '../models/Notification.js';
import Product from '../models/Product.js';
import { querySTKPushStatus } from '../controllers/paymentController.js';
import { scheduleDebouncedBackup } from '../services/backupService.js';

// Helper function to decrement inventory (copied from paymentController to avoid circular deps or logic fragmentation)
const decrementInventory = async (orderItems) => {
  try {
    for (const item of orderItems) {
      const productId = item.product || item.productId || item._id;
      if (productId) {
        const updatedProduct = await Product.findByIdAndUpdate(
          productId,
          { $inc: { stock: -item.quantity, sold: item.quantity } },
          { new: true }
        );

        if (updatedProduct && updatedProduct.stock <= 0) {
          await Product.findByIdAndUpdate(productId, { inStock: false });
          await Notification.create({
            type: 'SYSTEM',
            message: `🚨 OUT OF STOCK: ${updatedProduct.name} has sold out!`
          });
        }
      }
    }
  } catch (err) {
    console.error('⚠️ Cron: Error decrementing inventory:', err.message);
  }
};

export const initMpesaSyncCron = () => {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('🕒 CRON: Starting M-Pesa status sync...');

    try {
      // Find orders that are:
      // 1. M-Pesa payment method
      // 2. Not paid yet
      // 3. Status is pending
      // 4. Created between 5 minutes and 24 hours ago
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 1000);

      const stuckOrders = await Order.find({
        paymentMethod: 'M-Pesa',
        isPaid: false,
        status: 'pending',
        mpesaCheckoutRequestId: { $exists: true, $ne: '' },
        createdAt: { $gte: twentyFourHoursAgo, $lte: fiveMinsAgo }
      });

      console.log(`🔍 CRON: Found ${stuckOrders.length} potentially stuck M-Pesa orders.`);

      for (const order of stuckOrders) {
        try {
          console.log(`📡 CRON: Querying status for order ${order._id} (ID: ${order.mpesaCheckoutRequestId})`);
          
          const result = await querySTKPushStatus(order.mpesaCheckoutRequestId);
          
          // ResultCode "0" means Success in Daraja Query API
          if (result.ResultCode === '0') {
            console.log(`✅ CRON: Order ${order._id} was actually PAID. Syncing state...`);

            // Update Order
            order.isPaid = true;
            order.paidAt = new Date();
            order.status = 'processing';
            order.paymentResult = {
              id: result.MpesaReceiptNumber || 'CRON_SYNC',
              status: 'Completed',
              amountPaid: order.totalAmount
            };
            await order.save();

            // Create Transaction record
            await Transaction.create({
              userEmail: order.userEmail || order.contactEmail || 'customer@seekon.com',
              method: 'mpesa',
              amount: order.totalAmount,
              status: 'completed',
              reference: result.MpesaReceiptNumber || order.mpesaCheckoutRequestId,
              callbackData: { source: 'cron_sync', daraja_response: result }
            });

            // Inventory & Notifications
            await decrementInventory(order.items);
            
            await Notification.create({
              type: 'NEW_ORDER',
              message: `Payment synced via Cron! Order ${order._id.toString().slice(-6)} paid via M-Pesa: KSh ${order.totalAmount}`,
              orderId: order._id
            });

            // Clear cart
            if (order.user) {
              await Cart.findOneAndUpdate(
                { userId: order.user },
                { items: [], totalItems: 0, totalPrice: 0 }
              );
            }

            scheduleDebouncedBackup();
          } 
          // If the request was cancelled, timed out or failed (anything other than "0" or "In Progress")
          // ResultCode "1032" is Cancelled, "1037" is Timeout, etc.
          // We only mark as failed if it's a definitive failure code from Safaricom
          else if (['1032', '1037', '1', '2001'].includes(result.ResultCode)) {
            console.log(`❌ CRON: Order ${order._id} failed with code ${result.ResultCode}. Marking as failed.`);
            order.status = 'failed';
            await order.save();
          }
          
        } catch (error) {
          // If Safaricom returns 404/500 for the query, we log and skip to next order
          // This usually happens if the CheckoutRequestID is invalid or expired
          console.error(`⚠️ CRON: Failed to sync order ${order._id}:`, error.message);
        }
      }

      console.log('✅ CRON: M-Pesa status sync completed.');
    } catch (err) {
      console.error('🔥 CRON: Global error in M-Pesa sync:', err.message);
    }
  });

  // Memory Cleanup Cron: Run garbage collection every 15 minutes to reclaim unused V8 RAM
  cron.schedule('*/15 * * * *', () => {
    if (global.gc) {
      try {
        global.gc();
        console.log('🧹 [CRON]: Node.js process Garbage Collection forced successfully.');
      } catch (e) {
        console.warn('⚠️ [CRON]: Manual garbage collection failed:', e.message);
      }
    } else {
      // Graceful log - no-op if expose-gc flag isn't set
      console.log('🧹 [CRON]: Manual GC skipped (expose-gc flag not enabled in startup).');
    }
  });
};
