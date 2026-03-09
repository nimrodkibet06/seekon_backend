import User from '../models/User.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import SystemLog from '../models/SystemLog.js';

// Get All Users
export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, status } = req.query;

    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status) {
      query.status = status;
    }

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
};

// Get Single User
export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user'
    });
  }
};

// Update User Status and Role
export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, role } = req.body;

    // If changing role to admin, also set isAdmin
    // If changing role to user, also set isAdmin to false
    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (role !== undefined) {
      updateData.role = role;
      updateData.isAdmin = (role === 'admin');
    }

    // Check if trying to remove admin role
    if (role === 'user') {
      // Count total admins before this update
      const adminCount = await User.countDocuments({ role: 'admin' });
      const targetUser = await User.findById(id);
      
      // If this user is an admin and they're the only one, prevent demotion
      if (targetUser && targetUser.role === 'admin' && adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote the only admin. Please promote another user to admin first.'
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Log action
    await SystemLog.create({
      action: status !== undefined ? (status === 'active' ? 'user_activated' : 'user_deactivated') : 'user_role_updated',
      actor: req.admin?.email || 'system',
      actorType: 'admin',
      details: { userId: id, status, role },
      module: 'user'
    });

    res.status(200).json({
      success: true,
      message: 'User status updated',
      user
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user: ' + error.message
    });
  }
};

// Delete User - Cascading Hard Delete
// This deletes the user AND all associated carts and orders
// to prevent orphaned data from crashing analytics
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Safety Check: Prevent admin from deleting themselves
    if (req.user && req.user._id.toString() === id) {
      return res.status(400).json({ 
        success: false, 
        message: "You cannot delete your own admin account." 
      });
    }
    
    // Also check req.admin for admin routes
    if (req.admin && req.admin._id && req.admin._id.toString() === id) {
      return res.status(400).json({ 
        success: false, 
        message: "You cannot delete your own admin account." 
      });
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 2. Cascade Delete: Wipe out their carts (Cart uses userId field)
    const cartsDeleted = await Cart.deleteMany({ userId: id }).catch(e => { 
      console.log('No carts found for user:', id); 
      return { deletedCount: 0 }; 
    });
    console.log(`🗑️ Deleted ${cartsDeleted.deletedCount || 0} carts for user ${id}`);

    // 3. Cascade Delete: Wipe out their orders (Order uses user field)
    const ordersDeleted = await Order.deleteMany({ user: id }).catch(e => { 
      console.log('No orders found for user:', id); 
      return { deletedCount: 0 }; 
    });
    console.log(`🗑️ Deleted ${ordersDeleted.deletedCount || 0} orders for user ${id}`);

    // 4. Finally, Hard Delete the User
    await User.findByIdAndDelete(id);
    console.log(`🗑️ User ${id} permanently deleted`);

    // Log action
    await SystemLog.create({
      action: 'user_deleted_cascade',
      actor: req.admin?.email || 'system',
      actorType: 'admin',
      details: { 
        userId: id, 
        cartsDeleted: cartsDeleted.deletedCount || 0,
        ordersDeleted: ordersDeleted.deletedCount || 0
      },
      module: 'user'
    });

    res.status(200).json({ 
      success: true, 
      message: "User and all associated test data have been permanently deleted." 
    });
  } catch (error) {
    console.error('Error hard-deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user: ' + error.message
    });
  }
};



