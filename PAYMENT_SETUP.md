# Payment System Setup Guide

This guide will help you set up the M-Pesa and Flutterwave payment integration for Seekon Apparel.

## 🎯 Features

- **M-Pesa STK Push**: Automatic mobile payment for Kenyan users
- **Flutterwave**: Card and mobile money payments for international users
- **Transaction Tracking**: All payments stored in MongoDB
- **Real-time Status**: Live payment updates and callbacks

---

## 📋 Prerequisites

1. Node.js (v14+)
2. MongoDB database
3. M-Pesa Daraja API credentials (for Kenyan users)
4. Flutterwave account (for international payments)

---

## 🔑 M-Pesa (Daraja) Setup

### Step 1: Register for Daraja API

1. Go to [Safaricom Developer Portal](https://developer.safaricom.co.ke/)
2. Create an account and verify your email
3. Create a new application (e.g., "Seekon Apparel")
4. Get your **Consumer Key** and **Consumer Secret**

### Step 2: Get Sandbox Credentials

For testing (sandbox mode):

```
Consumer Key: Your sandbox consumer key
Consumer Secret: Your sandbox consumer secret
Shortcode: 174379 (default test shortcode)
Passkey: Your passkey from Daraja portal
```

**Important**: The passkey is generated in your Daraja portal under "STK Push" section.

### Step 3: Configure Callback URL

Your callback URL should point to your backend:

```
CALLBACK_URL=http://localhost:3000/api/payment/mpesa-callback
```

For production, use your actual domain:
```
CALLBACK_URL=https://yourdomain.com/api/payment/mpesa-callback
```

---

## 💳 Flutterwave Setup

### Step 1: Create Account

1. Go to [Flutterwave Dashboard](https://dashboard.flutterwave.com/)
2. Sign up for an account
3. Complete KYC verification

### Step 2: Get API Keys

1. Navigate to Settings → API Keys
2. Copy your **Secret Key** and **Public Key**
3. Use test keys for sandbox, live keys for production

---

## 🔧 Environment Variables

Create a `.env` file in `seekoon-backend/` with the following:

```env
# MongoDB
MONGO_URI=mongodb://localhost:27017/seekon-apparel

# JWT
JWT_SECRET=your_secret_key_here

# M-Pesa - PRODUCTION Credentials
# Get from https://developer.safaricom.co.ke/
CONSUMER_KEY=your_consumer_key
CONSUMER_SECRET=your_consumer_secret
SHORTCODE=your_business_shortcode
PASSKEY=your_passkey
CALLBACK_URL=https://your-production-url

# Alternative variable names (also supported)
DARAJA_CONSUMER_KEY=your_consumer_key
DARAJA_CONSUMER_SECRET=your_consumer_secret
DARAJA_BUSINESS_SHORTCODE=your_shortcode
DARAJA_PASS_KEY=your_passkey

# MPESA_ prefixed variables (also supported)
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=your_shortcode
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://your-production-url/api/payment/mpesa-callback

# Environment: 'sandbox' for testing, 'production' for live (default: production)
MPESA_ENVIRONMENT=production

# Flutterwave
FLW_SECRET_KEY=your_flutterwave_secret_key
FLW_PUBLIC_KEY=your_flutterwave_public_key

# Frontend
FRONTEND_URL=http://localhost:5173

# Server
PORT=3000
NODE_ENV=development
```

### Sandbox Testing Setup

For testing with M-Pesa Sandbox:

```env
MPESA_ENVIRONMENT=sandbox
CONSUMER_KEY=your_sandbox_consumer_key
CONSUMER_SECRET=your_sandbox_consumer_secret
SHORTCODE=174379
# Passkey is auto-set to Safaricom's default sandbox passkey
```

---

## 🚀 API Endpoints

### 1. Initiate M-Pesa Payment

**Endpoint:** `POST /api/payment/mpesa`

**Request:**
```json
{
  "phoneNumber": "254712345678",
  "amount": 1000,
  "userEmail": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "STK Push sent. Please complete the payment on your phone.",
  "data": {
    "transactionId": "transaction_id",
    "reference": "MPESA1234567890",
    "checkoutRequestID": "ws_CO_123456"
  }
}
```

### 2. Initiate Flutterwave Payment

**Endpoint:** `POST /api/payment/flutterwave`

**Request:**
```json
{
  "email": "user@example.com",
  "amount": 1000,
  "userEmail": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment link generated",
  "data": {
    "transactionId": "transaction_id",
    "reference": "FLW1234567890",
    "paymentLink": "https://checkout.flutterwave.com/..."
  }
}
```

### 3. Get User Transactions

**Endpoint:** `GET /api/payment/transactions/:userEmail`

**Response:**
```json
{
  "success": true,
  "transactions": [
    {
      "userEmail": "user@example.com",
      "method": "mpesa",
      "amount": 1000,
      "status": "completed",
      "reference": "MPESA1234567890",
      "createdAt": "2025-01-15T10:00:00Z"
    }
  ]
}
```

---

## 🧪 Testing M-Pesa (Sandbox)

### Enable Sandbox Mode

Set the environment variable in your `.env` file:

```env
MPESA_ENVIRONMENT=sandbox
```

### Test Phone Numbers

Use these test numbers from Daraja documentation:

```
Phone Number: 254708374149
Amount: KSh 1 - KSh 70,000
```

When sandbox mode is enabled, the amount will automatically be set to 1 KSh regardless of the order total.

### Test Credentials

```
Shortcode: 174379
Passkey: Get from your Daraja portal

Consumer Key: Your sandbox consumer key
Consumer Secret: Your sandbox consumer secret
```

### Expected Flow

1. User enters phone number and amount
2. System sends STK Push to phone
3. User receives prompt on phone
4. User enters M-Pesa PIN
5. System receives callback and updates transaction status
6. Frontend shows success/failure message

---

## 🎨 Frontend Integration

The checkout page (`seekon-front-end/src/pages/Checkout.jsx`) includes:

- **Email input**: User's email address
- **Payment method selector**: M-Pesa or Card
- **Phone number input**: For M-Pesa users
- **Order summary**: Shows cart items and total
- **Real-time status**: Loading, success, or failure
- **Smooth animations**: Framer Motion transitions

### M-Pesa Payment Flow

1. User selects M-Pesa as payment method
2. User enters their M-Pesa phone number (format: 254XXXXXXXXX)
3. User clicks "Pay Now"
4. Backend sends STK Push to user's phone
5. User receives prompt on their phone to enter PIN
6. Safaricom sends callback to backend with payment result
7. Frontend polls or receives update on payment status

### Phone Number Format

The system automatically formats phone numbers:
- `07XX XXX XXXX` → `2547XX XXX XXXX`
- `+254XXXXXXXXX` → `254XXXXXXXXX`
- `254XXXXXXXXX` → stays as is

### Usage

```jsx
import Checkout from './pages/Checkout';

// In your router
<Route path="/checkout" element={<Checkout />} />
```

---

## 🔒 Security Considerations

1. **Never expose API keys** in frontend code
2. **Use HTTPS** in production
3. **Validate phone numbers** on backend
4. **Sanitize user inputs**
5. **Store sensitive data** in environment variables
6. **Implement rate limiting** for payment endpoints
7. **Log all transactions** for auditing

---

## 🐛 Troubleshooting

### "Failed to initiate payment"

- Check API credentials in `.env`
- Verify network connection
- Check Daraja/Flutterwave dashboard for errors

### "Callback not received"

- Ensure callback URL is publicly accessible (use ngrok for local testing)
- Check server logs for callback requests
- Verify callback URL in Daraja/Flutterwave settings

### "Transaction not updated"

- Check MongoDB connection
- Verify transaction reference matching
- Review callback data in server logs

---

## 📚 Additional Resources

- [M-Pesa Daraja API Documentation](https://developer.safaricom.co.ke/)
- [Flutterwave Documentation](https://developer.flutterwave.com/docs)
- [MongoDB Documentation](https://docs.mongodb.com/)

---

## ✅ Next Steps

After setup:

1. Test with sandbox credentials
2. Complete production setup
3. Integrate email notifications
4. Add transaction history dashboard
5. Implement receipt generation
6. Set up webhook monitoring




