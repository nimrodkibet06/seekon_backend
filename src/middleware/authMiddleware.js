import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/User.js';

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      console.log('🔐 Token decoded:', decoded);

      // CRITICAL: Handle both 'id' and 'userId' for backward compatibility
      // Token uses userId, so prioritize that
      const userId = decoded.userId || decoded.id;
      console.log('👤 Attempting to find User with ID:', userId);

      // CRITICAL: Fetch user from database and attach to req.user
      req.user = await User.findById(userId).select('-password');
      
      console.log('👤 User found:', req.user ? req.user.email : 'NULL');

      // CRITICAL: Ensure user exists before proceeding
      if (!req.user) {
        console.error('🚨 User not found in database for ID:', userId);
        return res.status(401).json({ 
          success: false,
          message: 'User not found. Account may have been deleted.' 
        });
      }

      next();
    } catch (error) {
      console.error('🔥 Token Verification Failed:', error.message);
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized, token failed' 
      });
    }
  } else {
    console.error('🚨 No token provided in request');
    return res.status(401).json({ 
      success: false,
      message: 'Not authorized, no token' 
    });
  }
});

const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(401);
    throw new Error('Not authorized as an admin');
  }
};

export { protect, admin };