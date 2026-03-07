import Transaction from '../models/Transaction.js';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'seekon_secret_key';

// Get Admin Stats - Real business metrics
export const getAdminStats = async (req, res) => {
  try {
    // Get counts for users, products, and orders
    const [totalUsers, totalOrders, productCount] = await Promise.all([
      User.countDocuments({}),
      Order.countDocuments({}),
      Product.countDocuments()
    ]);
    
    // Calculate total revenue (sum of totalAmount where isPaid is true)
    const paidOrders = await Order.find({ isPaid: true });
    const totalRevenue = paidOrders.reduce((acc, order) => acc + order.totalAmount, 0);
    
    // Get recent orders for dashboard
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'name email');
    
    // Get top products
    const topProducts = await Product.find()
      .sort({ sold: -1 })
      .limit(5);
    
    // Get recent users for activities
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(3);
    
    // 1. Calculate Monthly Sales (Group paid orders by month)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Get current year
    const currentYear = new Date().getFullYear();
    
    // Monthly sales aggregation
    const monthlySalesRaw = await Order.aggregate([
      { $match: { isPaid: true, createdAt: { $gte: new Date(`${currentYear}-01-01`) } } },
      { $group: { _id: { $month: '$createdAt' }, revenue: { $sum: '$totalAmount' } } },
      { $sort: { '_id': 1 } }
    ]);
    
    const monthlySales = monthlySalesRaw.map(item => ({
      month: monthNames[item._id - 1] || 'Unknown',
      value: item.revenue || 0
    }));
    
    // 2. Sales by Category (Aggregate sold items from orders by category)
    // First, get all paid orders with their items
    const paidOrdersWithItems = await Order.find({ isPaid: true }).populate('items.product');
    
    // Aggregate by category from order items
    const categoryMap = {};
    paidOrdersWithItems.forEach(order => {
      order.items.forEach(item => {
        if (item.product && item.product.category) {
          const cat = item.product.category;
          categoryMap[cat] = (categoryMap[cat] || 0) + item.quantity;
        }
      });
    });
    
    // If no orders yet, fall back to product count by category
    if (Object.keys(categoryMap).length === 0) {
      const productCategories = await Product.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]);
      productCategories.forEach(cat => {
        categoryMap[cat._id || 'Uncategorized'] = cat.count;
      });
    }
    
    const salesByCategory = Object.entries(categoryMap).map(([name, value]) => ({
      name: name || 'Uncategorized',
      value: value || 0
    }));
    
    // 3. Weekly Revenue (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const weeklyRevenueRaw = await Order.aggregate([
      { $match: { isPaid: true, createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: '$totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Fill in missing days with zero values
    const weeklyRevenue = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const found = weeklyRevenueRaw.find(r => r._id === dateStr);
      weeklyRevenue.push({
        _id: dateStr,
        total: found ? found.total : 0
      });
    }
    
    // 4. Growth Rate - Simple calculation: compare this month vs last month
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    
    const [thisMonthOrders, lastMonthOrders] = await Promise.all([
      Order.countDocuments({ isPaid: true, createdAt: { $gte: thisMonthStart } }),
      Order.countDocuments({ isPaid: true, createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } })
    ]);
    
    let growthRate = 0;
    if (lastMonthOrders > 0) {
      growthRate = ((thisMonthOrders - lastMonthOrders) / lastMonthOrders * 100).toFixed(1);
    } else if (thisMonthOrders > 0) {
      growthRate = 100; // First month with orders
    }
    
    res.status(200).json({
      success: true,
      stats: {
        today: { revenue: 0, successful: 0, failed: 0, pending: 0, orders: 0, newUsers: 0 },
        total: {
          revenue: totalRevenue,
          successful: 0,
          failed: 0,
          pending: 0,
          users: totalUsers,
          products: productCount,
          orders: totalOrders
        },
        weeklyRevenue: weeklyRevenue,
        monthlySales: monthlySales,
        salesByCategory: salesByCategory,
        growthRate: parseFloat(growthRate)
      },
      recentOrders: recentOrders.map(order => ({
        id: order._id,
        customer: order.user?.name || order.guestName || 'Guest',
        amount: order.totalAmount,
        status: order.status,
        date: new Date(order.createdAt).toLocaleDateString(),
        paymentMethod: order.paymentMethod || 'M-Pesa'
      })),
      topProducts: topProducts.map(product => ({
        id: product._id,
        name: product.name,
        sold: product.sold || 0,
        revenue: (product.sold || 0) * product.price,
        category: product.category
      })),
      recentActivities: recentUsers.map(user => ({
        type: 'user',
        message: `New user registered: ${user.name}`,
        time: new Date(user.createdAt).toLocaleDateString(),
        icon: '👤'
      }))
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch admin stats' 
    });
  }
};

// Admin Login
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find admin
    const admin = await Admin.findOne({ email });
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await admin.comparePassword(password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate JWT
    const token = jwt.sign(
      {
        userId: admin._id,
        email: admin.email,
        role: admin.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

// Get Dashboard Stats
export const getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    
    // Today's stats
    const todayStats = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: todayStart }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$amount' }
        }
      }
    ]);

    // Total stats
    const totalStats = await Transaction.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$amount' }
        }
      }
    ]);

    // Weekly revenue
    const weeklyRevenue = await Transaction.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: weekStart }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Calculate totals
    const today = {
      successful: todayStats.find(s => s._id === 'completed')?.count || 0,
      failed: todayStats.find(s => s._id === 'failed')?.count || 0,
      pending: todayStats.find(s => s._id === 'pending')?.count || 0,
      revenue: todayStats.find(s => s._id === 'completed')?.total || 0
    };

    const total = {
      successful: totalStats.find(s => s._id === 'completed')?.count || 0,
      failed: totalStats.find(s => s._id === 'failed')?.count || 0,
      pending: totalStats.find(s => s._id === 'pending')?.count || 0,
      revenue: totalStats.find(s => s._id === 'completed')?.total || 0
    };

    // Get counts for users, products, and orders
    const [userCount, productCount, orderCount] = await Promise.all([
      User.countDocuments(),
      Product.countDocuments(),
      Order.countDocuments()
    ]);

    // Get recent orders for dashboard
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'name email');

    // Get top products
    const topProducts = await Product.find()
      .sort({ sold: -1 })
      .limit(5);

    // Get recent activities
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(3);

    res.status(200).json({
      success: true,
      stats: {
        today,
        total: {
          ...total,
          users: userCount,
          products: productCount,
          orders: orderCount
        },
        weeklyRevenue
      },
      recentOrders: recentOrders.map(order => ({
        id: order._id,
        customer: order.user?.name || order.guestName || 'Guest',
        amount: order.totalAmount,
        status: order.status,
        date: new Date(order.createdAt).toLocaleDateString(),
        paymentMethod: order.paymentMethod || 'M-Pesa'
      })),
      topProducts: topProducts.map(product => ({
        id: product._id,
        name: product.name,
        sold: product.sold || 0,
        revenue: (product.sold || 0) * product.price,
        category: product.category
      })),
      recentActivities: [
        ...recentUsers.map(user => ({
          type: 'user',
          message: `New user registered: ${user.name}`,
          time: new Date(user.createdAt).toLocaleDateString(),
          icon: '👤'
        }))
      ]
    });
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats'
    });
  }
};

// Get All Transactions
export const getAllTransactions = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status, 
      search, 
      startDate, 
      endDate 
    } = req.query;

    // Build query
    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (search) {
      query.$or = [
        { phoneNumber: { $regex: search, $options: 'i' } },
        { userEmail: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Get transactions
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Get total count
    const total = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions'
    });
  }
};

// Get Single Transaction
export const getTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    
    const transaction = await Transaction.findById(id);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.status(200).json({
      success: true,
      transaction
    });
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction'
    });
  }
};

// Export Transactions to CSV
export const exportTransactions = async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;

    const query = {};
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query).sort({ createdAt: -1 });

    // Convert to CSV
    const headers = 'Phone Number,Email,Amount,Status,Reference,Date,Method\n';
    const rows = transactions.map(t => {
      return `"${t.phoneNumber}","${t.userEmail}",${t.amount},"${t.status}","${t.reference}","${t.createdAt}",${t.method}`;
    }).join('\n');

    const csv = headers + rows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export transactions'
    });
  }
};

// Get Analytics Data - Real data for charts using MongoDB Aggregation
// Uses isPaid or status filter based on query parameter
export const getAnalytics = async (req, res) => {
  try {
    // Get period from query parameter (default: month)
    const period = req.query.period || 'month';
    
    // Get total users count
    const totalUsers = await User.countDocuments({});
    
    // ==============================================
    // CALCULATE DATE RANGE BASED ON PERIOD
    // ==============================================
    const now = new Date();
    let startDate;
    let dateFormat;
    let groupBy;
    let labelFormat;
    
    if (period === 'week') {
      // Last 7 days
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      dateFormat = '%Y-%m-%d';
      groupBy = { $dateToString: { format: dateFormat, date: '$createdAt' } };
      labelFormat = (date) => {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return dayNames[new Date(date).getDay()];
      };
    } else if (period === 'year') {
      // Last 12 months
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
      groupBy = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } };
      labelFormat = (dateObj) => {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return monthNames[(dateObj.month || 1) - 1];
      };
    } else {
      // Default: month (last 30 days or 4 weeks)
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      dateFormat = '%Y-%m-%d';
      groupBy = { $dateToString: { format: dateFormat, date: '$createdAt' } };
      labelFormat = (date) => {
        const d = new Date(date);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      };
    }
    
    // ==============================================
    // 1. REVENUE OVER TIME - MongoDB Aggregation
    // Filter: isPaid: true OR status in [processing, shipped, delivered]
    // ==============================================
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // MongoDB Aggregation: Group orders by period
    const revenueAggregation = await Order.aggregate([
      {
        $match: {
          $or: [
            { isPaid: true },
            { status: { $in: ['processing', 'shipped', 'delivered'] } }
          ],
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: groupBy,
          revenue: { $sum: '$totalAmount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
    
    // Format revenue trends based on period
    const revenueTrends = revenueAggregation.map(item => {
      if (period === 'year') {
        return {
          month: monthNames[(item._id.month || 1) - 1],
          value: item.revenue || 0,
          count: item.count || 0
        };
      } else {
        return {
          month: labelFormat(item._id),
          value: item.revenue || 0,
          count: item.count || 0
        };
      }
    });
    
    // ==============================================
    // 2. CATEGORY DISTRIBUTION - Product counts by category
    // ==============================================
    const categoryDistribution = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    const categoryCounts = categoryDistribution.map(cat => ({
      name: cat._id || 'Uncategorized',
      value: cat.count || 0
    }));
    
    // ==============================================
    // 3. SALES BY CATEGORY - Revenue by category
    // ==============================================
    const salesByCategoryRaw = await Order.aggregate([
      {
        $match: {
          $or: [
            { isPaid: true },
            { status: { $in: ['processing', 'shipped', 'delivered'] } }
          ]
        }
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      { $unwind: '$productInfo' },
      {
        $group: {
          _id: '$productInfo.category',
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          quantity: { $sum: '$items.quantity' }
        }
      },
      { $sort: { revenue: -1 } }
    ]);
    
    const categorySales = salesByCategoryRaw.map(cat => ({
      name: cat._id || 'Uncategorized',
      value: cat.revenue || 0,
      quantity: cat.quantity || 0
    }));
    
    // Fallback: If no orders yet, use product count by category
    if (categorySales.length === 0) {
      categorySales.push(...categoryCounts);
    }
    
    // ==============================================
    // CALCULATE TOTALS
    // ==============================================
    const totalOrders = await Order.countDocuments({
      $or: [
        { isPaid: true },
        { status: { $in: ['processing', 'shipped', 'delivered'] } }
      ]
    });
    
    const totalRevenueResult = await Order.aggregate([
      {
        $match: {
          $or: [
            { isPaid: true },
            { status: { $in: ['processing', 'shipped', 'delivered'] } }
          ]
        }
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const totalRevenue = totalRevenueResult[0]?.total || 0;
    
    res.json({
      success: true,
      totalRevenue,
      totalOrders,
      totalUsers,
      revenueTrends,
      categorySales,
      categoryCounts,
      period // Return the period used for debugging
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics data'
    });
  }
};

// Cleanup abandoned orders (older than 1 hour with pending status)
export const cleanupAbandonedOrders = async (req, res) => {
  try {
    // Calculate date 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Find and delete all pending orders older than 1 hour
    const result = await Order.deleteMany({ 
      status: 'pending', 
      createdAt: { $lt: oneHourAgo } 
    });

    console.log(`🧹 Cleanup: Deleted ${result.deletedCount} abandoned orders`);

    res.json({ 
      success: true, 
      message: `Deleted ${result.deletedCount} abandoned orders.` 
    });
  } catch (error) {
    console.error('Error cleaning up abandoned orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup abandoned orders'
    });
  }
};

