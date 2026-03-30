const webpush = require('web-push');

// Keys will be added to .env by the user
webpush.setVapidDetails(
  'mailto:admin@seekon.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = webpush;
