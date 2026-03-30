import express from 'express';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import webpush from '../utils/webPush.js';

const router = express.Router();

// Subscribe to push notifications (admin only)
router.post('/push/subscribe', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { subscription } = req.body;
    
    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: 'Push subscription is required'
      });
    }

    // Save subscription to user's document
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { pushSubscription: subscription },
      { new: true }
    );

    console.log('✅ Push subscription saved for admin:', user.email);

    res.status(200).json({
      success: true,
      message: 'Push notifications subscribed successfully'
    });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe to push notifications'
    });
  }
});

// Get VAPID public key for frontend
router.get('/push/vapid-public-key', (req, res) => {
  res.status(200).json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY || ''
  });
});

// Send push notification to all admins
const sendPushNotificationToAdmins = async (title, message) => {
  try {
    const admins = await User.find({ role: 'admin', pushSubscription: { $ne: null } });
    
    for (const admin of admins) {
      if (admin.pushSubscription) {
        await webpush.sendNotification(
          admin.pushSubscription,
          JSON.stringify({ title, body: message })
        );
        console.log('✅ Push notification sent to admin:', admin.email);
      }
    }
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};

export { sendPushNotificationToAdmins };

// Get all notifications (admin only)
router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .limit(20);
    
    const unreadCount = await Notification.countDocuments({ isRead: false });
    
    res.status(200).json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// Mark notification as read
router.patch('/:id/read', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );
    
    res.status(200).json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// Mark all as read
router.patch('/read-all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { isRead: false },
      { isRead: true }
    );
    
    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all as read'
    });
  }
});

// Delete notification
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
});

export default router;
