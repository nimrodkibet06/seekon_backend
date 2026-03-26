import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    unique: true,
    trim: true,
    uppercase: true
  },
  description: {
    type: String,
    default: ''
  },
  image: {
    type: String,
    default: ''
  },
  // Hierarchical structure: subcategories and brands specific to this category
  subCategories: [{
    type: String,
    trim: true,
    uppercase: true
  }],
  brands: [{
    type: String,
    trim: true,
    uppercase: true
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  // Parent categories for many-to-many hierarchical structure
  parentCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: []
  }]
}, {
  timestamps: true
});

export default mongoose.model('Category', categorySchema);
