import mongoose from 'mongoose';

const systemLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'user_login',
      'user_logout',
      'user_register',
      'user_role_updated',
      'payment_initiated',
      'payment_completed',
      'payment_failed',
      'order_created',
      'order_updated',
      'order_cancelled',
      'product_created',
      'product_updated',
      'product_deleted',
      'admin_login',
      'admin_logout',
      'system_error',
      'api_call',
      'export_data',
      'settings_updated'
    ]
  },
  actor: {
    type: String,
    required: true // Email or username of who performed action
  },
  actorType: {
    type: String,
    enum: ['user', 'admin', 'system'],
    default: 'user'
  },
  details: {
    type: mongoose.Schema.Types.Mixed // Flexible object for various data
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    default: 'info'
  },
  module: {
    type: String,
    enum: ['auth', 'payment', 'order', 'product', 'user', 'admin', 'system']
  }
}, {
  timestamps: true
});

// Index for faster queries
systemLogSchema.index({ createdAt: -1 });
systemLogSchema.index({ action: 1 });
systemLogSchema.index({ actor: 1 });

export default mongoose.model('SystemLog', systemLogSchema);




