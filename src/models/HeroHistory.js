import mongoose from 'mongoose';

const heroHistorySchema = new mongoose.Schema({
  heroVideoUrl: {
    type: String,
    required: true
  },
  cloudinaryPublicId: {
    type: String,
    required: true
  },
  resourceType: {
    type: String,
    enum: ['image', 'video'],
    default: 'video'
  },
  heroHeading: {
    type: String,
    default: 'STEP INTO THE FUTURE'
  },
  heroSubtitle: {
    type: String,
    default: 'Discover the latest drops from Nike, Adidas, Jordan, and more.'
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, { timestamps: true });

const HeroHistory = mongoose.model('HeroHistory', heroHistorySchema);
export default HeroHistory;
