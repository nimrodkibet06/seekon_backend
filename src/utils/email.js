 // Email utility using Resend API for production
import { Resend } from 'resend';
import { isServiceConfigured, getMissingConfig } from '../config/checkEnv.js';

let resendClient = null;
let resendChecked = false;
const resendConfigured = isServiceConfigured('resend');

// Load Resend client
const getResendClient = () => {
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
  const frontendUrl = process.env.FRONTEND_URL || 'https://www.seek-on.app';
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
  const resetUrl = `https://www.seek-on.app/reset-password/${token}`;
  
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
          <a href="https://www.seek-on.app/collection" style="background-color: #00A676; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Shop Now</a>
        </div>
      `
    });
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending welcome email:', error.message);
    return { success: false };
  }
};

/**
 * Send welcome email to new registered users
 * @param {string} name - User's name
 * @param {string} email - User's email address
 */
export const sendWelcomeEmail = async (name, email) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://www.seek-on.app';
  
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
      subject: 'Welcome to Seekon! 🎉 Your Exclusive Welcome Gift Inside!',,
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
