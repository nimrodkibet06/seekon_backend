const mongoose = require('mongoose');
const Product = require('../models/Product.js');
const User = require('../models/User.js');
const Category = require('../models/Category.js');
const Order = require('../models/Order.js');
const { getResendClient } = require('./email.js');
const { isServiceConfigured, getMissingConfig } = require('../config/checkEnv.js');

/**
 * Create a backup of all critical collections and email them as JSON attachments
 */
const createBackupAndEmail = async () => {
  try {
    console.log('🔄 Starting daily MongoDB backup process...');
    
    // Check if Resend is configured
    const resend = getResendClient();
    if (!resend) {
      console.warn('⚠️ Resend API is not configured - backup emails will not be sent');
      return { success: false, message: 'Resend not configured' };
    }
    
    // Fetch data from all collections
    console.log('📥 Fetching data from collections...');
    
    const [products, users, categories, orders] = await Promise.all([
      Product.find({}).lean(),
      User.find({}).select('-password -__v').lean(),
      Category.find({}).lean(),
      Order.find({}).lean()
    ]);
    
    console.log(`📊 Data fetched: ${products.length} products, ${users.length} users, ${categories.length} categories, ${orders.length} orders`);
    
    // Convert to JSON strings with proper formatting
    const productsJson = JSON.stringify(products, null, 2);
    const usersJson = JSON.stringify(users, null, 2);
    const categoriesJson = JSON.stringify(categories, null, 2);
    const ordersJson = JSON.stringify(orders, null, 2);
    
    // Prepare email attachments
    const attachments = [
      { filename: 'products.json', content: productsJson },
      { filename: 'users.json', content: usersJson },
      { filename: 'categories.json', content: categoriesJson },
      { filename: 'orders.json', content: ordersJson }
    ];
    
    // Send email to target (configurable via BACKUP_TARGET_EMAIL with fallbacks)
    const targetEmail = process.env.BACKUP_TARGET_EMAIL || process.env.ADMIN_EMAIL || 'seekonapparel77@gmail.com';
    const backupDate = new Date().toISOString().split('T')[0];
    
    console.log(`📦 Preparing to send database backup to: ${targetEmail}`);
    
    const emailData = await resend.emails.send({
      from: 'Seekon <noreply@seekonapparelglobal.com>',
      to: targetEmail,
      subject: `🔄 Daily MongoDB Backup - ${backupDate}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #00A676; margin: 0;">SEEKON</h1>
            <p style="color: #666; margin: 5px 0 0 0;">Daily Database Backup</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 10px;">
            <h2 style="color: #333; margin-top: 0;">Backup Completed Successfully</h2>
            <p style="color: #666; font-size: 15px; line-height: 1.5;">
              Your daily MongoDB backup has been generated and attached to this email.
            </p>
            
            <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #2e7d32;">Backup Details:</h3>
              <ul style="color: #424242; margin: 10px 0 0 20px; padding: 0;">
                <li><strong>Date:</strong> ${new Date().toLocaleString()}</li>
                <li><strong>Products:</strong> ${products.length} records</li>
                <li><strong>Users:</strong> ${users.length} records</li>
                <li><strong>Categories:</strong> ${categories.length} records</li>
                <li><strong>Orders:</strong> ${orders.length} records</li>
              </ul>
            </div>
            
            <p style="color: #888; font-size: 13px; text-align: center; margin-top: 25px;">
              This is an automated backup from the Seekon e-commerce platform.
            </p>
          </div>
        </div>
      `,
      attachments: attachments
    });
    
    console.log(`✅ Backup email sent successfully to ${targetEmail}`);
    console.log('✅ Daily MongoDB backup process completed');
    
    return { 
      success: true, 
      message: 'Backup completed and emailed successfully',
      data: emailData,
      stats: { products: products.length, users: users.length, categories: categories.length, orders: orders.length }
    };
    
  } catch (error) {
    console.error('❌ Error during backup process:', error.message);
    console.error('   Full error:', JSON.stringify(error, null, 2));
    return { success: false, error: error.message };
  }
};

module.exports = { createBackupAndEmail };