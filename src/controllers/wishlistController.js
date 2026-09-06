import Wishlist from '../models/Wishlist.js';

// Get user's wishlist
export const getWishlist = async (req, res) => {
  try {
    const { userId } = req.params;
    
    let wishlist = await Wishlist.findOne({ userId }).populate('items.productId');
    
    if (!wishlist) {
      wishlist = await Wishlist.create({ userId, items: [] });
    }
    
    res.status(200).json({
      success: true,
      wishlist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Add item to wishlist
export const addToWishlist = async (req, res) => {
  try {
    const { userId } = req.params;
    const { productId, name, brand, price, image } = req.body;
    
    let wishlist = await Wishlist.findOne({ userId });
    
    if (!wishlist) {
      wishlist = await Wishlist.create({ userId, items: [] });
    }
    
    const result = wishlist.addItem(productId, name, brand, price, image);
    
    await wishlist.save();
    
    res.status(200).json({
      success: true,
      message: result.message,
      added: result.added,
      wishlist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Remove item from wishlist
export const removeFromWishlist = async (req, res) => {
  try {
    const { userId } = req.params;
    const { productId } = req.body;
    
    const wishlist = await Wishlist.findOne({ userId });
    
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }
    
    wishlist.items = wishlist.items.filter(
      item => item.productId.toString() !== productId.toString()
    );
    
    await wishlist.save();
    
    res.status(200).json({
      success: true,
      message: 'Item removed from wishlist',
      wishlist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Clear wishlist
export const clearWishlist = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const wishlist = await Wishlist.findOne({ userId });
    
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }
    
    wishlist.items = [];
    await wishlist.save();
    
    res.status(200).json({
      success: true,
      message: 'Wishlist cleared',
      wishlist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};




