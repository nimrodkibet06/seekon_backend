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
      from: 'Seekon <noreply@seek-on.app>',
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
      from: 'Seekon <noreply@seek-on.app>',
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
      from: 'Seekon <noreply@seek-on.app>',
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
