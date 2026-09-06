import mongoose from 'mongoose';

const flashStatusSchema = new mongoose.Schema({
  mediaUrl: {
    type: String,
    required: true
  },
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    required: true
  },
  caption: {
    type: String,
    default: ''
  },
  author: {
    type: String,
    required: true
  },
  cloudinaryPublicId: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const FlashStatus = mongoose.model('FlashStatus', flashStatusSchema);

export default FlashStatus;
