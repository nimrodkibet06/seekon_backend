import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true
  },
  phoneNumber: {
    type: String,
    required: false
  },
  method: {
    type: String,
    enum: ['mpesa', 'card', 'flutterwave'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  reference: {
    type: String,
    required: true,
    unique: true
  },
  mpesaResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  flutterwaveResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  callbackData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true
});

export default mongoose.model('Transaction', transactionSchema);




