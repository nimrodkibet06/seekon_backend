import webpush from 'web-push';

const hasVapidKeys =
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;

if (hasVapidKeys) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:noreply@seekonapparelglobal.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('⚠️ VAPID keys not set — web push notifications are disabled');
}

export const isPushConfigured = () => hasVapidKeys;
export default webpush;
