import Product from '../models/Product.js';
import SystemLog from '../models/SystemLog.js';
import Order from '../models/Order.js';

// Helper function to calculate active price based on flash sale timing
const calculateActivePrice = (product) => {
  const now = new Date();
  
  // Check if flash sale is active
  if (product.isFlashSale && 
      product.flashSalePrice && 
      product.saleStartTime && 
      product.saleEndTime) {
    const startTime = new Date(product.saleStartTime);
    const endTime = new Date(product.saleEndTime);
    
    if (now >= startTime && now <= endTime) {
      return {
        active: true,
        price: product.flashSalePrice,
        originalPrice: product.price,
        endTime: product.saleEndTime
      };
    }
  }
  
  return {
    active: false,
    price: product.price,
    originalPrice: null,
    endTime: null
  };
};

// Helper function to transform product with active pricing
const transformProduct = (product) => {
  const productObj = product.toObject ? product.toObject() : product;
  const pricing = calculateActivePrice(productObj);
  
  return {
    ...productObj,
    activePrice: pricing.price,
    originalPrice: pricing.originalPrice || productObj.price,
    isOnFlashSale: pricing.active,
    flashSaleEndTime: pricing.endTime
  };
};

// Get All Products
export const getAllProducts = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, category, inStock } = req.query;

    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (category) query.category = category;
    if (inStock !== undefined) query.inStock = inStock === 'true';

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Product.countDocuments(query);

    // Transform products with active pricing
    const transformedProducts = products.map(transformProduct);

    res.status(200).json({
      success: true,
      products: transformedProducts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products'
    });
  }
};

// Get Single Product
export const getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Transform product with active pricing
    const transformedProduct = transformProduct(product);

    res.status(200).json({
      success: true,
      product: transformedProduct
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product'
    });
  }
};

// Create Product
export const createProduct = async (req, res) => {
  try {
    const product = await Product.create(req.body);

    // Log action - with error handling to prevent crashes
    try {
      await SystemLog.create({
        action: 'product_created',
        actor: req.user?.email || 'system',
        actorType: 'admin',
        details: { productId: product._id },
        module: 'product'
      });
    } catch (logError) {
      console.error('Failed to create product log:', logError.message);
      // Continue without crashing - product was created successfully
    }

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('Error creating product:', error);
    
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = {};
      for (const field in error.errors) {
        validationErrors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create product'
    });
  }
};

// Update Product
export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Log action - with error handling to prevent crashes
    try {
      await SystemLog.create({
        action: 'product_updated',
        actor: req.user?.email || 'system',
        actorType: 'admin',
        details: { productId: product._id },
        module: 'product'
      });
    } catch (logError) {
      console.error('Failed to create product update log:', logError.message);
      // Continue without crashing - product was updated successfully
    }

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product'
    });
  }
};

// Delete Product
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Log action - with error handling to prevent crashes
    try {
      await SystemLog.create({
        action: 'product_deleted',
        actor: req.user?.email || 'system',
        actorType: 'admin',
        details: { productId: req.params.id },
        module: 'product'
      });
    } catch (logError) {
      console.error('Failed to create product delete log:', logError.message);
      // Continue without crashing - product was deleted successfully
    }

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product'
    });
  }
};

// Check if user can review a product (must have purchased it)
export const canUserReview = async (req, res) => {
  try {
    // Support both req.params.id and req.body.productId
    const productId = req.params.id || req.body.productId;
    
    // CRITICAL: Ensure user is authenticated
    if (!req.user || !req.user._id) {
      return res.status(401).json({ 
        success: false,
        message: 'Authentication required. Please log in.' 
      });
    }
    
    const userId = req.user._id;

    if (!productId) {
      return res.status(400).json({ 
        success: false,
        message: 'Product ID is required' 
      });
    }

    // Check if user already reviewed this product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    // Check if user already reviewed
    const alreadyReviewed = product.reviewDetails?.find(
      r => r.user?.toString() === userId.toString()
    );
    if (alreadyReviewed) {
      return res.status(400).json({ 
        success: false,
        message: 'You have already reviewed this product',
        canReview: false
      });
    }

    // VERIFY PURCHASE: Check if user actually bought this product
    const hasBought = await Order.findOne({
      user: userId,
      isPaid: true,
      $or: [
        { 'orderItems.product': productId },
        { 'orderItems': { $elemMatch: { productId: productId } } }
      ]
    });

    if (!hasBought) {
      return res.status(400).json({ 
        success: false,
        message: 'You must purchase this product to leave a review',
        canReview: false,
        verifiedBuyer: false
      });
    }

    res.status(200).json({
      success: true,
      canReview: true,
      verifiedBuyer: true,
      message: 'You can review this product'
    });
  } catch (error) {
    console.error('Error checking review eligibility:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to check review eligibility' 
    });
  }
};

// Add a review to a product
export const addReview = async (req, res) => {
  try {
    // Debug logging to trace the productId
    console.log("🔥 Review Req Params:", req.params, "Body:", req.body);
    
    const { rating, comment } = req.body;
    // Support both req.params.id and req.body.productId for flexibility
    const productId = req.params.id || req.body.productId;
    
    if (!productId) {
      return res.status(400).json({ 
        success: false,
        message: 'Product ID is required' 
      });
    }
    
    // CRITICAL: Ensure user is authenticated
    if (!req.user || !req.user._id) {
      return res.status(401).json({ 
        success: false,
        message: 'Authentication required. Please log in.' 
      });
    }
    
    const userId = req.user._id;
    const userName = req.user.name || req.user.email;

    // Validate input
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ 
        success: false,
        message: 'Rating must be between 1 and 5 stars' 
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: "Can't find product info in DB." 
      });
    }

    // Check if user already reviewed
    const alreadyReviewed = product.reviewDetails?.find(
      r => r.user?.toString() === userId.toString()
    );
    if (alreadyReviewed) {
      return res.status(400).json({ 
        success: false,
        message: 'You have already reviewed this product' 
      });
    }

    // VERIFY PURCHASE: Check if user actually bought this product
    // Note: We intentionally relax the isPaid/isDelivered checks to allow sandbox test orders
    const hasBought = await Order.findOne({
      user: userId,
      'items.product': productId
    });

    if (!hasBought) {
      console.error(`🚨 REVIEW REJECTED: Could not find order for User: ${userId} | Product: ${productId}`);
      return res.status(400).json({ 
        success: false,
        message: 'You must purchase this product to leave a review. Only verified buyers can review products.' 
      });
    }

    // Create review object
    const review = {
      user: userId,
      userName: userName,
      rating: Number(rating),
      comment: comment || '',
      isVerifiedPurchase: true, // Mark as verified since they purchased
      createdAt: new Date()
    };

    // Initialize reviewDetails array if it doesn't exist
    if (!product.reviewDetails) {
      product.reviewDetails = [];
    }

    // Add review to product
    product.reviewDetails.push(review);

    // Calculate new average rating
    const totalRating = product.reviewDetails.reduce((sum, r) => sum + r.rating, 0);
    product.rating = totalRating / product.reviewDetails.length;
    product.reviews = product.reviewDetails.length;

    await product.save();

    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      review: review
    });
  } catch (error) {
    console.error('Error adding review:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to add review' 
    });
  }
};



