import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Optional for guest checkout
  },
  userEmail: {
    type: String,
    required: false
  },
  items: [{
    product: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Product', 
      required: [true, 'Product ID is strictly required for order items']
    },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    size: String,
    color: { type: String, required: true },
    image: { type: String, required: true }
  }],
  totalAmount: {
    type: Number,
    required: false,
    default: 0
  },
  paymentMethod: {
    type: String,
    enum: ['M-Pesa', 'Card', 'Flutterwave', 'm-pesa', 'card', 'flutterwave'],
    default: 'M-Pesa'
  },
  paymentReference: {
    type: String
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  mpesaCheckoutRequestId: {
    type: String
  },
  isPaid: {
    type: Boolean,
    default: false
  },
  paidAt: {
    type: Date
  },
  paymentResult: {
    id: String,
    status: String,
    email_address: String
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'failed'],
    default: 'pending'
  },
  shippingAddress: {
    name: String,
    phone: String,
    address: String,
    city: String,
    postalCode: String
  },
  shippingPrice: {
    type: Number,
    default: 0
  },
  shippingMethod: {
    type: String,
    default: ''
  },
  notes: {
    type: String
  },
  expectedArrival: {
    type: String
  },
  deliveryDetails: {
    type: String
  }
}, {
  timestamps: true
});

export default mongoose.model('Order', orderSchema);




