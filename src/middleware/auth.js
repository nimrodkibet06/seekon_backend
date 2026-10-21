import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';

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
 * Optional auth — attaches req.user when a valid token is present; does not block guests.
 */
export const optionalAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    if (!process.env.JWT_SECRET) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      ...decoded,
      _id: decoded.userId || decoded._id
    };
    next();
  } catch {
    next();
  }
};

/**
 * Role Authorization Middlewares
 */
/**
 * Middleware to authorize specific roles (RBAC)
 * Allows access if user has one of the specified roles (e.g., 'admin', 'cashier')
 */
export const authorizeRoles = (...roles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Access denied. Authentication required.'
        });
      }

      let userRole = req.user.role;

      // Database fallback if role is not present in the JWT payload
      if (!userRole && req.user._id) {
        const user = await User.findById(req.user._id).select('role isAdmin');
        if (user) {
          userRole = user.role || (user.isAdmin ? 'admin' : 'user');
          req.user.role = userRole;
        } else {
          const admin = await Admin.findById(req.user._id).select('role');
          if (admin) {
            userRole = admin.role || 'admin';
            req.user.role = userRole;
          }
        }
      }

      // Allow superadmin access to any admin-permitted route
      if (userRole === 'superadmin' && roles.includes('admin')) {
        return next();
      }

      if (!roles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Role '${userRole || 'unauthorized'}' is not authorized to access this route.`
        });
      }

      next();
    } catch (error) {
      console.error('Role authorization error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal authorization error'
      });
    }
  };
};

export const adminMiddleware = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
  }
  next();
};

