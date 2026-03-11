import jwt from 'jsonwebtoken';

/**
 * Middleware to verify JWT token
 */
export const authMiddleware = (req, res, next) => {
  try {
    // Debug: Log JWT_SECRET presence
    if (!process.env.JWT_SECRET) {
      console.error('🚨 CRITICAL: JWT_SECRET is not defined in environment!');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }
    
    console.log('🔐 JWT_SECRET is present:', process.env.JWT_SECRET ? 'YES' : 'NO');
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    console.log('🔐 Auth middleware - Authorization header:', authHeader);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Auth failed: No token or invalid format');
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    console.log('🔐 Token extracted:', token ? `${token.substring(0, 20)}...` : 'empty');
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token decoded successfully:', decoded);
    
    // Map userId to _id for backward compatibility with controllers expecting _id
    req.user = {
      ...decoded,
      _id: decoded.userId || decoded._id
    };
    console.log('✅ req.user set:', req.user);
    next();
  } catch (error) {
    console.error('❌ Token verification failed:', error.message);
    console.error('❌ Error name:', error.name);
    
    if (error.name === 'TokenExpiredError') {
      console.error('⏰ Token has expired');
      return res.status(401).json({
        success: false,
        message: 'Token has expired. Please log in again.',
        error: 'TokenExpiredError'
      });
    } else if (error.name === 'JsonWebTokenError') {
      console.error('🔑 Token is invalid');
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        error: 'JsonWebTokenError'
      });
    }
    
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      error: error.message
    });
  }
};

/**
 * Middleware to check if user is admin
 */
export const adminMiddleware = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
  }
  next();
};

