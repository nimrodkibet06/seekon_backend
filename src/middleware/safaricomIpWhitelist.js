// Official Safaricom Daraja IP ranges (Subject to updates by Safaricom)
const safaricomIPs = [
  '196.201.214.200',
  '196.201.214.206', 
  '196.201.213.114',
  '196.201.214.207',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.138',
  '196.201.212.129',
  '196.201.212.136',
  '196.201.212.74',
  '196.201.212.69'
];

export const safaricomIpWhitelist = (req, res, next) => {
  // Get the IP of the incoming request (handle proxies like Railway/Vercel)
  let requestIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.socket?.remoteAddress;
  
  // Clean the IP string if it contains multiple IPs or IPv6 prefix (::ffff:)
  if (requestIp && requestIp.includes(',')) {
    requestIp = requestIp.split(',')[0].trim();
  }
  if (requestIp && requestIp.startsWith('::ffff:')) {
    requestIp = requestIp.replace('::ffff:', '');
  }

  // Allow localhost for local testing/webhook forwarding
  const isLocalhost = requestIp === '127.0.0.1' || requestIp === '::1' || requestIp === '::ffff:127.0.0.1';
  
  // Allow in development mode
  if (process.env.NODE_ENV === 'development' || isLocalhost) {
    console.log(`🔓 Development mode: Allowing request from ${requestIp}`);
    return next();
  }
  
  // Check if IP is in whitelist
  if (safaricomIPs.includes(requestIp)) {
    return next();
  }
  
  // Block unauthorized requests
  console.warn(`🚨 SECURITY ALERT: Blocked fake callback attempt from IP: ${requestIp}`);
  return res.status(403).json({ 
    success: false,
    message: "Forbidden: Invalid IP Address" 
  });
};
