import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  originalPrice: {
    type: Number
  },
  discount: {
    type: Number,
    default: 0
  },
  image: {
    type: String,
    required: true
  },
  images: [{
    type: String
  }],
  category: {
    type: String,
    required: [true, 'Please select category'],
    enum: {
      values: [
        'Sneakers',
        'Apparel', 
        'Boots',
        'Men',
        'Women',
        'Kids',
        'Accessories'
      ],
      message: 'Please select correct category'
    }
  },
  subCategory: {
    type: String,
    default: ''
  },
  brand: {
    type: String,
    required: true
  },
  sizes: [{
    type: String
  }],
  colors: [{
    type: String
  }],
  stock: {
    type: Number,
    default: 0
  },
  inStock: {
    type: Boolean,
    default: true
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviews: {
    type: Number,
    default: 0
  },
  reviewDetails: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    userName: {
      type: String,
      default: 'Anonymous'
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      required: true
    },
    isVerifiedPurchase: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  newProduct: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String
  }],
  // Flash Sale fields
  isFlashSale: {
    type: Boolean,
    default: false
  },
  flashSalePrice: {
    type: Number,
    default: null
  },
  saleStartTime: {
    type: Date,
    default: null
  },
  saleEndTime: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

export default mongoose.model('Product', productSchema);

