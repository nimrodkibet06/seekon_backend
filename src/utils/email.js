 // Email utility using Resend API for production
import { Resend } from 'resend';
import { isServiceConfigured, getMissingConfig } from '../config/checkEnv.js';

let resendClient = null;
let resendChecked = false;
const resendConfigured = isServiceConfigured('resend');

// Load Resend client
export const getResendClient = () => {
  if (resendClient) return resendClient;
  if (resendChecked) return null;
  
  // Check if Resend is configured
  if (!resendConfigured) {
    const missing = getMissingConfig('resend');
    console.warn('⚠️  Resend API is not configured - emails will be logged to console');
    if (missing.length > 0) {
      console.warn('   Missing configuration:');
      missing.forEach(({ name }) => {
        console.warn(`   - ${name}`);
      });
    }
    resendChecked = true;
    return null;
  }
  
  try {
    resendClient = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ Resend client initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Resend client:', error.message);
  }
  
  resendChecked = true;
  return resendClient;
};

// Log email to console for development
const logEmailToConsole = (type, to, url) => {
  const line = '='.repeat(50);
  console.log('\n' + line);
  console.log(` 📧 ${type}`);
  console.log(line);
  console.log(` To:      ${to}`);
  console.log(` Link:    ${url}`);
  console.log(line);
  console.log(' \n ⚠️  RESEND API NOT CONFIGURED');
  console.log('    To enable real emails:');
  console.log('    1. Sign up at https://resend.com');
  console.log('    2. Get your API key from https://resend.com/api-keys');
  console.log('    3. Add to server/.env:');
  console.log('       RESEND_API_KEY=re_123456789');
  console.log('    4. Restart the server');
  console.log(' ' + line + '\n');
};

// Function to send verification email
export const sendVerificationEmail = async (email, token) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com';
  const verificationUrl = `${frontendUrl}/verify-email/${token}`;
  
  // Try to get Resend client
  const resend = getResendClient();
  
  // Development mode - log to console if no client
  if (!resend) {
    logEmailToConsole('VERIFICATION EMAIL', email, verificationUrl);
    return { 
      success: true, 
      message: 'Email logged to console (check server logs)',
      development: true,
      verificationUrl
    };
  }

  try {
    const data = await resend.emails.send({
      from: 'Seekon <noreply@seekonapparelglobal.com>',
      to: email,
      subject: 'Verify Your Email Address',
      html: `
        <h2>Verify Your Email</h2>
        <p>Thank you for registering with Seekon. Please click the link below to verify your email address:</p>
        <a href="${verificationUrl}" style="display: inline-block; padding: 10px 20px; color: white; background-color: #007bff; text-decoration: none; border-radius: 5px;">Verify Email</a>
        <p>If the button above doesn't work, copy and paste this link into your browser:</p>
        <p>${verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
        <p>If you did not create an account with Seekon, please ignore this email.</p>
      `
    });
    console.log(`✅ Verification email sent to ${email}:`, data);
    return { success: true, message: 'Verification email sent successfully', data };
  } catch (error) {
    console.error('❌ Error sending verification email:', error.message);
    console.error('   Full error:', JSON.stringify(error, null, 2));
    // Fall back to console logging on error
    console.log('⚠️  Resend API failed. Falling back to console logging...');
    logEmailToConsole('VERIFICATION EMAIL', email, verificationUrl);
    return {
      success: true,
      message: 'Email logged to console (Resend API failed)',
      development: true,
      verificationUrl
    };
  }
};

// Function to send password reset email
export const sendPasswordResetEmail = async (email, token) => {
  // Use the new domain for password reset links
  const resetUrl = `${process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com'}/reset-password/${token}`;
  
  // Try to get Resend client
  const resend = getResendClient();
  
  // Development mode - log to console if no client
  if (!resend) {
    logEmailToConsole('PASSWORD RESET EMAIL', email, resetUrl);
    return { 
      success: true, 
      message: 'Email logged to console (check server logs)',
      development: true,
      resetUrl
    };
  }
  
  try {
    const data = await resend.emails.send({
      from: 'Seekon <noreply@seekonapparelglobal.com>',
      to: email,
      subject: 'Reset Your Password',
      html: `
        <h2>Password Reset Request</h2>
        <p>We received a request to reset your password. Click the link below to set a new password:</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; color: white; background-color: #007bff; text-decoration: none; border-radius: 5px;">Reset Password</a>
        <p>If the button above doesn't work, copy and paste this link into your browser:</p>
        <p>${resetUrl}</p>
        <p>This link will expire in 10 minutes for security reasons.</p>
        <p>If you did not request a password reset, please ignore this email or contact support.</p>
      `
    });
    console.log(`✅ Password reset email sent to ${email}:`, data);
    return { success: true, message: 'Password reset email sent successfully', data };
  } catch (error) {
    console.error('❌ Error sending password reset email:', error.message);
    console.error('   Full error:', JSON.stringify(error, null, 2));
    // Fall back to console logging on error
    console.log('⚠️  Resend API failed. Falling back to console logging...');
    logEmailToConsole('PASSWORD RESET EMAIL', email, resetUrl);
    return {
      success: true,
      message: 'Email logged to console (Resend API failed)',
      development: true,
      resetUrl
    };
  }
};

// Function to send OTP email
export const sendOTPEmail = async (email, otp) => {
  // Log OTP to console for development
  const line = '='.repeat(50);
  console.log('\n' + line);
  console.log(` 📧 OTP EMAIL`);
  line;
  console.log(` To:      ${email}`);
  console.log(` OTP:     ${otp}`);
  console.log(` Expires: 15 minutes`);
  console.log(line + '\n');
  
  // Try to get Resend client
  const resend = getResendClient();
  
  // Development mode - just log to console
  if (!resend) {
    return { 
      success: true, 
      message: 'OTP logged to console (check server logs)',
      development: true,
      otp
    };
  }
  
  try {
    const data = await resend.emails.send({
      from: 'Seekon <noreply@seekonapparelglobal.com>',
      to: email,
      subject: 'Your Seekon Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #333;">Verify Your Email</h2>
          <p>Thank you for registering with Seekon. Please use the verification code below to complete your registration:</p>
          <div style="background: linear-gradient(135deg, #00A676, #008A5E); color: white; padding: 20px; text-align: center; border-radius: 10px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">${otp}</span>
          </div>
          <p style="color: #666; font-size: 14px;">This code will expire in <strong>15 minutes</strong> for security reasons.</p>
          <p style="color: #666; font-size: 14px;">If you did not create an account with Seekon, please ignore this email.</p>
        </div>
      `
    });
    console.log(`✅ OTP email sent to ${email}:`, data);
    return { success: true, message: 'OTP email sent successfully', data };
  } catch (error) {
    console.error('❌ Error sending OTP email:', error.message);
    console.error('   Full error:', JSON.stringify(error, null, 2));
    return { success: false, message: error.message };
  }
};

// Function to send contact form submissions to Admin Gmail
export const sendContactEmail = async (name, email, subject, message) => {
  const resend = getResendClient();
  const adminEmail = 'seekonapparel77@gmail.com';

  if (!resend) {
    console.log(`\n📧 NEW CONTACT MESSAGE\nFrom: ${name} (${email})\nSubject: ${subject}\nMessage: ${message}\n`);
    return { success: true, development: true };
  }

  try {
    const data = await resend.emails.send({
      from: 'Seekon Contact Form <noreply@seekonapparelglobal.com>',
      to: adminEmail,
      reply_to: email,
      subject: `New Inquiry: ${subject}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #00A676;">New Message from Seekon Contact Form</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p><strong>Message:</strong></p>
          <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-radius: 8px; border-left: 4px solid #00A676;">${message}</p>
          
          <div style="margin-top: 30px; text-align: center;">
            <a href="mailto:${email}?subject=Re: ${subject}" style="background-color: #00A676; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Reply Directly to ${name}
            </a>
            <p style="font-size: 12px; color: #888; margin-top: 15px;">
              If the button above doesn't work, you can reply directly to: <br/>
              <strong>${email}</strong>
            </p>
          </div>
        </div>
      `
    });
    return { success: true, message: 'Message sent to admin', data };
  } catch (error) {
    console.error('❌ Error sending contact email:', error.message);
    return { success: false, message: error.message };
  }
};

// Send Newsletter Welcome Email
export const sendNewsletterWelcome = async (email) => {
  const resend = getResendClient();
  if (!resend) {
    console.log(`\n📧 NEWSLETTER WELCOME EMAIL\nTo: ${email}\nCode: SEEKON10\n(Development mode - no email sent)`);
    return { success: true, development: true };
  }
  try {
    await resend.emails.send({
      from: 'Seekon Apparel <noreply@seekonapparelglobal.com>',
      to: email,
      subject: 'Welcome to the Seekon Family! 🎉',
      html: `
        <div style="font-family: sans-serif; text-align: center; padding: 40px 20px; color: #333;">
          <h1 style="color: #00A676;">Welcome to Seekon Apparel!</h1>
          <p style="font-size: 16px; line-height: 1.5;">You're on the list. Get ready for exclusive drops, early access to flash sales, and premium streetwear inspiration.</p>
          <div style="margin: 30px 0; padding: 20px; background: #f4f4f4; border-radius: 8px;">
            <p style="margin: 0; font-size: 14px; color: #666;">As a thank you, use this code on your first order:</p>
            <h2 style="letter-spacing: 2px; color: #111;">SEEKON10</h2>
          </div>
          <a href="${process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com'}/collection" style="background-color: #00A676; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Shop Now</a>
        </div>
      `
    });
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending welcome email:', error.message);
    return { success: false };
  }
};

// Send Order Confirmation Email
export const sendOrderConfirmationEmail = async (email, order) => {
  const resend = getResendClient();
  const frontendUrl = process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com';
  
  const itemsList = order.items.map(item => `
    <tr class="item-tr">
      <td style="width: 70px;">
        <img src="${item.image || 'https://via.placeholder.com/60'}" alt="${item.name}" class="item-image" />
      </td>
      <td>
        <div class="item-details">
          <div class="item-name">${item.name}</div>
          <div class="item-specs">
            ${item.size ? `Size: ${item.size}` : ''} 
            ${item.color ? `| Color: ${item.color}` : ''}
          </div>
        </div>
      </td>
      <td class="item-qty">x${item.quantity}</td>
      <td class="item-price">KSh ${item.price.toLocaleString()}</td>
    </tr>
  `).join('');

  const orderHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          background-color: #FAFAF9;
          color: #0C0A09;
          font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .email-container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #FFFFFF;
          border: 1px solid #D6D3D1;
        }
        .header {
          padding: 40px 20px;
          text-align: center;
          border-bottom: 1px solid #FAFAF9;
        }
        .logo {
          font-family: 'Cormorant', Georgia, serif;
          font-size: 36px;
          font-weight: 600;
          letter-spacing: 6px;
          margin: 0;
          text-transform: uppercase;
          color: #1C1917;
        }
        .subtitle {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 3px;
          color: #44403C;
          margin-top: 5px;
        }
        .hero {
          text-align: center;
          padding: 30px 40px;
        }
        .hero h2 {
          font-family: 'Cormorant', Georgia, serif;
          font-size: 28px;
          font-weight: 500;
          margin-top: 0;
          margin-bottom: 15px;
          color: #1C1917;
        }
        .hero p {
          font-size: 14px;
          color: #44403C;
          line-height: 1.6;
          margin: 0;
        }
        .order-meta {
          padding: 24px 40px;
          background-color: #FAFAF9;
          border-top: 1px solid #D6D3D1;
          border-bottom: 1px solid #D6D3D1;
        }
        .meta-grid {
          display: table;
          width: 100%;
        }
        .meta-col {
          display: table-cell;
          width: 50%;
          font-size: 12px;
          line-height: 1.6;
          vertical-align: top;
        }
        .meta-title {
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #1C1917;
          margin-bottom: 6px;
        }
        .meta-value {
          color: #44403C;
        }
        .order-items {
          padding: 40px;
        }
        .item-table {
          width: 100%;
          border-collapse: collapse;
        }
        .item-th {
          font-family: 'Cormorant', Georgia, serif;
          font-size: 16px;
          font-weight: 600;
          text-align: left;
          border-bottom: 1px solid #1C1917;
          padding-bottom: 12px;
          color: #1C1917;
        }
        .item-tr td {
          padding: 20px 0;
          border-bottom: 1px solid #E8ECF0;
          vertical-align: middle;
        }
        .item-image {
          width: 60px;
          height: 60px;
          object-fit: cover;
          border: 1px solid #D6D3D1;
        }
        .item-details {
          font-size: 13px;
          line-height: 1.4;
          padding-left: 15px;
        }
        .item-name {
          font-weight: 500;
          color: #1C1917;
          margin-bottom: 4px;
        }
        .item-specs {
          font-size: 11px;
          color: #44403C;
        }
        .item-qty {
          font-size: 13px;
          color: #44403C;
          text-align: center;
        }
        .item-price {
          font-size: 13px;
          font-weight: 500;
          color: #1C1917;
          text-align: right;
        }
        .total-section {
          margin-top: 20px;
          border-top: 1px solid #1C1917;
          padding-top: 20px;
          text-align: right;
        }
        .total-row {
          margin-bottom: 8px;
          font-size: 13px;
          color: #44403C;
        }
        .total-amount {
          font-family: 'Cormorant', Georgia, serif;
          font-size: 22px;
          font-weight: 600;
          color: #1C1917;
          margin-top: 10px;
        }
        .fallback-box {
          margin: 20px 40px;
          padding: 24px;
          background-color: #FAFAF9;
          border: 1px dashed #D6D3D1;
          border-radius: 8px;
        }
        .fallback-title {
          font-family: 'Cormorant', Georgia, serif;
          font-size: 16px;
          font-weight: 600;
          color: #1C1917;
          margin-bottom: 8px;
          letter-spacing: 0.5px;
        }
        .fallback-text {
          font-size: 12px;
          color: #44403C;
          line-height: 1.6;
          margin: 0;
        }
        .cta-container {
          text-align: center;
          padding: 20px 40px 40px 40px;
        }
        .btn-track {
          display: inline-block;
          background-color: #A16207;
          color: #FFFFFF;
          padding: 16px 32px;
          text-decoration: none;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          transition: all 200ms ease;
          border: 1px solid #A16207;
        }
        .footer {
          background-color: #1C1917;
          padding: 40px 20px;
          text-align: center;
          color: #FFFFFF;
        }
        .footer p {
          margin: 0 0 10px 0;
          font-size: 11px;
          letter-spacing: 1px;
          color: #E8ECF0;
        }
        .footer a {
          color: #A16207;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <div class="logo">SEEKON</div>
          <div class="subtitle">Luxury Apparel</div>
        </div>
        
        <div class="hero">
          <h2>Order Confirmed</h2>
          <p>Thank you for your purchase. We are preparing your luxury pieces with meticulous care. Your structured order details are presented below.</p>
        </div>

        <div class="order-meta">
          <div class="meta-grid">
            <div class="meta-col">
              <div class="meta-title">Order ID</div>
              <div class="meta-value">${order._id}</div>
              <br />
              <div class="meta-title">Date</div>
              <div class="meta-value">${new Date(order.createdAt).toLocaleDateString()}</div>
            </div>
            <div class="meta-col">
              <div class="meta-title">Shipping To</div>
              <div class="meta-value">
                ${order.shippingAddress?.name || 'Customer'}<br />
                ${order.shippingAddress?.address || ''}<br />
                ${order.shippingAddress?.city || ''}<br />
                ${order.shippingAddress?.phone || ''}
              </div>
            </div>
          </div>
        </div>

        <div class="order-items">
          <table class="item-table">
            <thead>
              <tr>
                <th colspan="2" class="item-th">Item</th>
                <th class="item-th" style="text-align: center;">Qty</th>
                <th class="item-th" style="text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsList}
            </tbody>
          </table>

          <div class="total-section">
            <div class="total-row">Payment Method: <strong>${order.paymentMethod}</strong></div>
            <div class="total-amount">Total: KSh ${order.totalAmount.toLocaleString()}</div>
          </div>
        </div>

        <div class="fallback-box">
          <div class="fallback-title">Automated Notification Status</div>
          <p class="fallback-text">
            We attempt to route delivery tracking updates and courier details directly to your WhatsApp number: <strong>${order.shippingAddress?.phone || 'N/A'}</strong>. 
            If this number was entered incorrectly, is disconnected, or if our WhatsApp dispatcher goes offline, all subsequent updates will fall back to this email address.
          </p>
        </div>

        <div class="cta-container">
          <a href="${frontendUrl}/my-orders" class="btn-track" style="color: #FFFFFF;">Track Your Order</a>
        </div>

        <div class="footer">
          <p>© ${new Date().getFullYear()} Seekon Apparel. All rights reserved.</p>
          <p style="font-size: 10px; color: #E8ECF0; margin-top: 15px;">
            Need help? Contact our boutique concierge at <a href="mailto:support@seekonapparelglobal.com">support@seekonapparelglobal.com</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  if (!resend) {
    console.log(`\n📧 ORDER CONFIRMATION EMAIL\nTo: ${email}\nOrder ID: ${order._id}\nTotal: KSh ${order.totalAmount}\n(Development mode - no email sent)`);
    return { success: true, development: true };
  }

  try {
    await resend.emails.send({
      from: 'Seekon <noreply@seekonapparelglobal.com>',
      to: email,
      subject: `Order Confirmed! - ${order._id}`,
      html: orderHtml
    });
    console.log(`✅ Order confirmation email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending order confirmation:', error.message);
    return { success: false };
  }
};

// Send Admin Offline Alert Email
export const sendAdminOfflineAlertEmail = async (adminEmails = null) => {
  const resend = getResendClient();
  const frontendUrl = process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com';
  const recoveryUrl = `${frontendUrl}/admin/bot-status`;

  let toField;
  if (adminEmails && Array.isArray(adminEmails) && adminEmails.length > 0) {
    toField = adminEmails;
  } else {
    toField = process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || 'support@seekonapparelglobal.com';
  }

  const alertHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>URGENT ALERT: WhatsApp Client Offline</title>
      <style>
        body {
          font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background-color: #0C0A09;
          color: #FAFAF9;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #1C1917;
          border: 1px solid #DC2626;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 10px 15px rgba(0,0,0,0.5);
        }
        .header {
          background-color: #DC2626;
          padding: 24px;
          text-align: center;
        }
        .header h1 {
          font-family: 'Cormorant', Georgia, serif;
          font-size: 28px;
          font-weight: 700;
          color: #FFFFFF;
          margin: 0;
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        .content {
          padding: 40px 32px;
          line-height: 1.6;
        }
        .alert-badge {
          display: inline-block;
          background-color: rgba(220, 38, 38, 0.15);
          color: #DC2626;
          border: 1px solid #DC2626;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 24px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .message {
          font-size: 16px;
          color: #D6D3D1;
          margin-bottom: 32px;
        }
        .cta-container {
          text-align: center;
          margin-bottom: 32px;
        }
        .cta-button {
          display: inline-block;
          background-color: #A16207;
          color: #FFFFFF;
          padding: 14px 28px;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 15px;
          letter-spacing: 1px;
          text-transform: uppercase;
          transition: background-color 200ms ease;
          border: 1px solid #A16207;
        }
        .footer {
          background-color: #0C0A09;
          padding: 24px;
          text-align: center;
          border-top: 1px solid #44403C;
        }
        .footer p {
          margin: 0;
          font-size: 12px;
          color: #44403C;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Seekon Dispatcher</h1>
        </div>
        <div class="content">
          <div style="text-align: center;">
            <div class="alert-badge">Status: Offline</div>
          </div>
          <p class="message">
            <strong>CRITICAL:</strong> The WhatsApp communication engine has disconnected from the server. Automated WhatsApp messaging routes are currently unavailable. Customers will automatically fallback to receiving standard email order confirmations.
          </p>
          <p class="message" style="font-size: 14px; color: #888;">
            Please visit the admin status portal to scan the generated QR code and re-establish connection.
          </p>
          <div class="cta-container">
            <a href="${recoveryUrl}" class="cta-button" style="color: #FFFFFF;">Access Recovery Portal</a>
          </div>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Seekon Apparel. Internal Admin Alert.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  if (!resend) {
    console.log(`\n📧 ADMIN OFFLINE ALERT (Development)\nTo: ${toField}\nSubject: 🚨 URGENT: WhatsApp Client Offline\n(Development mode - no email sent)`);
    return { success: true, development: true };
  }

  try {
    const data = await resend.emails.send({
      from: 'Seekon System <noreply@seekonapparelglobal.com>',
      to: toField,
      subject: '🚨 URGENT: WhatsApp Client Offline',
      html: alertHtml
    });
    console.log(`✅ Admin offline alert email sent to ${toField}:`, data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Error sending admin offline alert:', error.message);
    return { success: false, message: error.message };
  }
};

// Send Order Status Update Email
export const sendOrderStatusUpdateEmail = async (email, order, newStatus) => {
  try {
    const resend = getResendClient();
    const frontendUrl = process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com';
    
    const statusMessages = {
      processing: 'Your order is being processed',
      shipped: 'Your order has been shipped',
      delivered: 'Your order has been delivered',
      pending: 'Your order is pending payment'
    };
    
    const statusEmojis = {
      processing: '⚙️',
      shipped: '🚚',
      delivered: '✅',
      pending: '⏳'
    };

    const cleanStatus = newStatus?.toLowerCase() || 'updated';
    const displayStatus = cleanStatus.charAt(0).toUpperCase() + cleanStatus.slice(1);
    
    const orderId = order?._id || order?.id || 'N/A';
    const totalAmountVal = order?.totalAmount || order?.total || 0;
    const formattedTotal = typeof totalAmountVal === 'number' ? totalAmountVal.toLocaleString() : totalAmountVal;

    let expectedArrivalHtml = '';
    if (order?.expectedArrival) {
      const isInvalidDate = isNaN(Date.parse(order.expectedArrival));
      const displayDate = isInvalidDate ? order.expectedArrival : new Date(order.expectedArrival).toLocaleDateString();
      expectedArrivalHtml = `
        <div style="padding: 15px; background: #e8f5e9; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0;"><strong>Expected Arrival:</strong> ${displayDate}</p>
        </div>
      `;
    }

    let deliveryDetailsHtml = '';
    if (order?.deliveryDetails) {
      deliveryDetailsHtml = `
        <div style="padding: 15px; background: #e3f2fd; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0;">Delivery Information</h3>
          <p style="margin: 0;">${order.deliveryDetails}</p>
        </div>
      `;
    }

    const statusHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #00A676; margin: 0;">SEEKON</h1>
          <p style="color: #666; margin: 5px 0 0 0;">Order Update</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #00A676, #008A5E); color: white; padding: 30px; border-radius: 15px; text-align: center; margin-bottom: 25px;">
          <span style="font-size: 48px;">${statusEmojis[cleanStatus] || '📦'}</span>
          <h2 style="margin: 15px 0 0 0;">${statusMessages[cleanStatus] || `Order status: ${displayStatus}`}</h2>
        </div>
        
        <div style="background: #f9f9f9; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
          <p style="margin: 0 0 10px 0;"><strong>Order ID:</strong> ${orderId}</p>
          <p style="margin: 0 0 10px 0;"><strong>Current Status:</strong> <span style="text-transform: capitalize;">${displayStatus}</span></p>
          <p style="margin: 0;"><strong>Total Amount:</strong> KSh ${formattedTotal}</p>
        </div>
        
        ${expectedArrivalHtml}
        ${deliveryDetailsHtml}
        
        <div style="text-align: center; margin-top: 30px;">
          <a href="${frontendUrl}/my-orders" style="display: inline-block; padding: 12px 24px; background-color: #00A676; color: white; text-decoration: none; border-radius: 6px;">View Order Details</a>
        </div>
        
        <p style="margin-top: 30px; color: #888; font-size: 12px; text-align: center;">
          Thank you for shopping with Seekon!
        </p>
      </div>
    `;

    if (!resend) {
      console.log(`\n📧 ORDER STATUS UPDATE EMAIL (MOCKED)\nTo: ${email}\nOrder ID: ${orderId}\nStatus: ${displayStatus}\n(Development mode - no email sent)`);
      return { success: true, development: true };
    }

    await resend.emails.send({
      from: 'Seekon <noreply@seekonapparelglobal.com>',
      to: email,
      subject: `Order Update: ${statusMessages[cleanStatus] || displayStatus} - ${orderId}`,
      html: statusHtml
    });
    console.log(`✅ Order status update email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending order status update email:', error.message);
    return { success: false };
  }
};

// Send Admin Notification Email
export const sendAdminNotification = async (subject, message, adminEmails = null) => {
  const resend = getResendClient();

  let toField;
  if (adminEmails && Array.isArray(adminEmails) && adminEmails.length > 0) {
    toField = adminEmails;
  } else {
    toField = process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || 'support@seekonapparelglobal.com';
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #dc2626; margin: 0;">SEEKON</h1>
        <p style="color: #666; margin: 5px 0 0 0;">Admin Notification</p>
      </div>
      
      <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 18px; color: #111; font-weight: 600;">${message}</p>
      </div>
      
      <p style="color: #888; font-size: 12px; text-align: center;">
        Sent at ${new Date().toLocaleString()}
      </p>
    </div>
  `;

  if (!resend) {
    console.log(`\n📧 ADMIN NOTIFICATION (Development)\nTo: ${toField}\nSubject: ${subject}\nMessage: ${message}\n`);
    return { success: true, development: true };
  }

  try {
    const data = await resend.emails.send({
      from: 'Seekon <noreply@seekonapparelglobal.com>',
      to: toField,
      subject: subject,
      html: html
    });
    console.log(`✅ Admin notification sent to ${toField}:`, data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Error sending admin notification:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Send welcome email to new registered users
 * @param {string} name - User's name
 * @param {string} email - User's email address
 */
export const sendWelcomeEmail = async (name, email) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://www.seekonapparelglobal.com';
  
  // Try to get Resend client
  const resend = getResendClient();
  
  // Development mode - log to console if no client
  if (!resend) {
    console.log(`\n📧 WELCOME EMAIL (Development)\nTo: ${email}\nName: ${name}\nPromo Code: WELCOME500\n`);
    return { 
      success: true, 
      message: 'Welcome email logged to console (check server logs)',
      development: true
    };
  }

  try {
    const data = await resend.emails.send({
      from: 'Seekon Apparel <noreply@seekonapparelglobal.com>',
      to: email,
      subject: 'Welcome to Seekon! 🎉 Your Exclusive Welcome Gift Inside!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          
          <!-- Header with Logo -->
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0; font-size: 32px;">SEEKON</h1>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Premium Fashion & Footwear</p>
          </div>
          
          <!-- Main Content -->
          <div style="background: #f9fafb; border-radius: 12px; padding: 30px; text-align: center;">
            <h2 style="color: #111; margin: 0 0 20px 0; font-size: 24px;">Welcome to Seekon, ${name.split(' ')[0]}! 🎉</h2>
            
            <p style="color: #666; font-size: 16px; margin: 0 0 25px 0;">
              Thank you for joining the Seekon family! We're thrilled to have you on board and can't wait for you to explore our curated collection of premium fashion and footwear.
            </p>
            
            <!-- Promo Code Box -->
            <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); border-radius: 12px; padding: 25px; margin: 30px 0; color: white;">
              <p style="margin: 0 0 10px 0; font-size: 14px; opacity: 0.9;">🎁 YOUR EXCLUSIVE WELCOME GIFT</p>
              <p style="margin: 0 0 15px 0; font-size: 28px; font-weight: bold; letter-spacing: 2px;">WELCOME500</p>
              <p style="margin: 0; font-size: 14px; opacity: 0.9;">Get KES 500 off your first order!</p>
            </div>
            
            <p style="color: #666; font-size: 14px; margin: 0 0 25px 0;">
              Use this code at checkout to redeem your welcome discount. This offer is valid for 30 days.
            </p>
            
            <!-- CTA Button -->
            <a href="${frontendUrl}" style="display: inline-block; padding: 14px 32px; color: white; background-color: #2563eb; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Start Shopping
            </a>
          </div>
          
          <!-- Features -->
          <div style="display: flex; justify-content: space-between; margin-top: 30px; padding: 0 20px;">
            <div style="text-align: center; flex: 1;">
              <span style="font-size: 24px;">🚚</span>
              <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Free Shipping</p>
            </div>
            <div style="text-align: center; flex: 1;">
              <span style="font-size: 24px;">↩️</span>
              <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Easy Returns</p>
            </div>
            <div style="text-align: center; flex: 1;">
              <span style="font-size: 24px;">💬</span>
              <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">24/7 Support</p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; color: #9ca3af; font-size: 12px;">
              Follow us on social media for the latest trends and exclusive deals
            </p>
            <p style="margin: 15px 0 0 0; color: #111; font-size: 14px;">
              © ${new Date().getFullYear()} Seekon Apparel. All rights reserved.
            </p>
          </div>
          
        </body>
        </html>
      `
    });
    console.log(`✅ Welcome email sent to ${email}:`, data);
    return { success: true, message: 'Welcome email sent successfully', data };
  } catch (error) {
    console.error('❌ Error sending welcome email:', error.message);
    // Fall back to console logging on error
    console.log(`⚠️  Welcome email failed. Logging to console...`);
    console.log(`📧 WELCOME EMAIL\nTo: ${email}\nName: ${name}\nPromo Code: WELCOME500\n`);
    return { 
      success: true, 
      message: 'Welcome email attempted but failed - logged to console',
      error: error.message 
    };
  }
};

// Function to send status success notification email
export const sendSuccessNotificationEmail = async (email, details) => {
  const resend = getResendClient();
  
  if (!resend) {
    console.log(`📧 SUCCESS NOTIFICATION EMAIL\nTo: ${email}\nDetails: ${JSON.stringify(details, null, 2)}`);
    return { success: true, message: 'Logged to console' };
  }

  try {
    const data = await resend.emails.send({
      from: 'Seekon Status Engine <noreply@seekonapparelglobal.com>',
      to: email,
      subject: '🔥 Seekon Status Engine: Successful Status Pull!',
      html: `
        <div style="font-family: sans-serif; color: #1f2937; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; border-bottom: 2px solid #10b981; padding-bottom: 16px; margin-bottom: 24px;">
            <h1 style="color: #10b981; margin: 0; font-size: 24px;">🎉 Successful Status Pull!</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0 0;">Zero-Click WhatsApp-to-Web Engine Status</p>
          </div>
          
          <p>Hi Admin,</p>
          
          <p>We are thrilled to notify you that the <strong>Seekon WhatsApp status engine</strong> has successfully intercepted, optimized, and published a new status update!</p>
          
          <div style="background-color: #f3f4f6; border-radius: 6px; padding: 16px; margin: 20px 0; font-family: monospace; font-size: 14px;">
            <p style="margin: 0 0 8px 0;"><strong>Status Details:</strong></p>
            <ul style="margin: 0; padding-left: 20px; line-height: 1.8;">
              <li><strong>Author:</strong> ${details.author}</li>
              <li><strong>Type:</strong> ${details.type}</li>
              <li><strong>Cloudinary URL:</strong> <a href="${details.mediaUrl}" target="_blank" style="color: #2563eb; text-decoration: none;">View Media</a></li>
              <li><strong>Timestamp:</strong> ${new Date(details.timestamp).toLocaleString()}</li>
            </ul>
          </div>
          
          <p>The status update is now live on the storefront home page circular stories tray and Navbar dropdown indicator.</p>
          
          <div style="text-align: center; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
            <p style="margin: 0; color: #9ca3af; font-size: 12px;">© ${new Date().getFullYear()} Seekon Apparel. All rights reserved.</p>
          </div>
        </div>
      `
    });
    console.log(`✅ Success notification email sent to ${email}:`, data);
    return { success: true, message: 'Notification email sent successfully', data };
  } catch (error) {
    console.error('❌ Error sending success notification email:', error.message);
    return { success: false, error: error.message };
  }
};
