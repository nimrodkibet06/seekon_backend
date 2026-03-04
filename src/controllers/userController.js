import User from '../models/User.js';
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

// Delete User
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Log action
    await SystemLog.create({
      action: 'user_deleted',
      actor: req.admin?.email || 'system',
      actorType: 'admin',
      details: { userId: id },
      module: 'user'
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};



