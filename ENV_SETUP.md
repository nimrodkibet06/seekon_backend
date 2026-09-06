# Environment Setup with Your M-Pesa Credentials

## ✅ Your Credentials

I've configured the backend to use your production M-Pesa credentials. Here's what you need to do:

### 1. Create `.env` file in `src/backend/`

Create a file named `.env` in the `src/backend/` directory with these contents:

```env
# MongoDB Connection
MONGO_URI=mongodb://localhost:27017/seekon-apparel

# JWT Secret
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production

# M-Pesa (Daraja) PRODUCTION Configuration
CONSUMER_KEY=wuS9OsWPVYsAn13SGn4FESATTGlUllRqAe2dFCr6coZ3ybdu
CONSUMER_SECRET=5XhjsWKPfkwCGPOXuRpRPiN8UfazIm8yoGznliWNHhQKfGAQh2Yip9W8Ip1lbMSl
SHORTCODE=247247
PASSKEY=your_live_passkey_here
CALLBACK_URL=https://your-public-callback-url/api/payment/mpesa-callback

# Alternative variable names (both supported)
DARAJA_CONSUMER_KEY=wuS9OsWPVYsAn13SGn4FESATTGlUllRqAe2dFCr6coZ3ybdu
DARAJA_CONSUMER_SECRET=5XhjsWKPfkwCGPOXuRpRPiN8UfazIm8yoGznliWNHhQKfGAQh2Yip9W8Ip1lbMSl
DARAJA_BUSINESS_SHORTCODE=247247

# Flutterwave Configuration (optional)
FLW_SECRET_KEY=your_flutterwave_secret_key
FLW_PUBLIC_KEY=your_flutterwave_public_key

# Frontend URL
FRONTEND_URL=http://localhost:5173

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 2. Get Your Live Passkey

You still need to add your **live passkey** from your Paybill 247247:

1. Go to [Safaricom Developer Portal](https://developer.safaricom.co.ke/)
2. Login with your Daraja account
3. Navigate to "My Apps" → Your Paybill app
4. Find "STK Push" section
5. Copy the **Pass Key**
6. Replace `your_live_passkey_here` in `.env`

### 3. Set Up Public Callback URL

For testing locally, use ngrok:

```bash
# Install ngrok globally
npm install -g ngrok

# Start ngrok tunnel
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Update CALLBACK_URL in .env:
CALLBACK_URL=https://abc123.ngrok.io/api/payment/mpesa-callback
```

### 4. Important Changes Made

#### Production API Endpoints
- ✅ Changed from `sandbox.safaricom.co.ke` to `api.safaricom.co.ke`
- ✅ Now using production M-Pesa API
- ✅ Your credentials are configured
- ✅ Shortcode updated to 247247 (your Paybill)

#### Backend Updates
- ✅ OAuth token endpoint: `https://api.safaricom.co.ke/oauth/v1/generate`
- ✅ STK Push endpoint: `https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest`
- ✅ Supports both `CONSUMER_KEY` and `DARAJA_CONSUMER_KEY` variable names
- ✅ Enhanced logging for debugging

### 5. Test Your Setup

```bash
# Start MongoDB
mongod

# Start backend (in src/backend/)
cd src/backend
npm run dev

# In another terminal, start frontend
cd ..
npm run dev

# Visit checkout page
open http://localhost:5173/checkout
```

### 6. What to Expect

When you visit the checkout page:

1. ✅ Payment auto-triggers immediately
2. ✅ STK Push sent to phone (should get prompt immediately)
3. ✅ Check phone for M-Pesa prompt
4. ✅ Enter PIN to complete
5. ✅ Backend receives callback and logs it

### 7. Troubleshooting

#### "Access token error"
- Check credentials in `.env`
- Verify credentials are from production (not sandbox)

#### "No prompt on phone"
- Check phone number is registered with M-Pesa
- Ensure phone has internet/data
- Verify amount is valid (minimum KSh 1)

#### "Callback not received"
- Use ngrok for local testing
- Update ngrok URL in `.env`
- Check backend logs for callback requests

### 8. Next Steps

1. ✅ Add your live passkey to `.env`
2. ✅ Set up ngrok for callback testing
3. ✅ Test with a real phone number
4. ✅ Check backend logs for confirmations

---

## 🚀 Ready to Test

Your backend is now configured for production M-Pesa payments!

Just add the passkey and set up ngrok for callbacks.




