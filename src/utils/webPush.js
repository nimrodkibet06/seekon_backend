import webpush from 'web-push';

// Configure VAPID keys for web push notifications
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@seekon.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default webpush;
