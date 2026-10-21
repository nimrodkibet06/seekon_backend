import mongoose from 'mongoose';

const pendingOrderSchema = new mongoose.Schema({
  customerName: {
    type: String,
    trim: true,
    default: 'WhatsApp Walk-in'
  },
  customerPhone: {
    type: String,
    required: [true, 'Customer phone number is required'],
    trim: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: false
    },
    name: {
      type: String,
      required: true
    },
    price: {
      type: Number,
      required: true,
      default: 0
    },
    quantity: {
      type: Number,
      required: true,
      default: 1
    },
    size: {
      type: String,
      default: ''
    },
    color: {
      type: String,
      default: 'Standard'
    }
  }],
  totalAmount: {
    type: Number,
    required: true,
    default: 0
  },
  paymentMethod: {
    type: String,
    enum: ['M-Pesa', 'Cash', 'Split', 'Card', 'Pending', 'POD', 'Cash on Delivery'],
    default: 'Pending'
  },
  payments: {
    cash: {
      type: Number,
      default: 0
    },
    mpesa: {
      type: Number,
      default: 0
    }
  },
  rawMessage: {
    type: String,
    required: true
  },
  senderJid: {
    type: String,
    default: ''
  },
  groupJid: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'dismissed'],
    default: 'pending'
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  completedOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: false
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for rapid querying of pending queue
pendingOrderSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('PendingOrder', pendingOrderSchema);
