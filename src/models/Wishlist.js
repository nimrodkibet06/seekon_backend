import mongoose from 'mongoose';

const wishlistItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  brand: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  image: {
    type: String,
    required: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const wishlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  items: [wishlistItemSchema]
}, {
  timestamps: true
});

// Prevent duplicate items
wishlistSchema.methods.addItem = function(productId, name, brand, price, image) {
  const existingItem = this.items.find(item => item.productId.toString() === productId.toString());
  
  if (!existingItem) {
    this.items.push({
      productId,
      name,
      brand,
      price,
      image,
      addedAt: new Date()
    });
    return { added: true, message: 'Item added to wishlist' };
  }
  
  return { added: false, message: 'Item already in wishlist' };
};

export default mongoose.model('Wishlist', wishlistSchema);




