# M-Pesa STK Push Troubleshooting Guide

This guide helps you debug and fix common M-Pesa STK Push issues.

## ✅ Common Issues and Solutions

### 1. "M-Pesa credentials not configured"

**Error:** `Please add CONSUMER_KEY and CONSUMER_SECRET to .env`

**Solution:**
1. Open `src/backend/.env` file
2. Add the following credentials:
```env
CONSUMER_KEY=your_consumer_key_here
CONSUMER_SECRET=your_consumer_secret_here
SHORTCODE=174379
PASSKEY=your_passkey_here
CALLBACK_URL=http://localhost:3000
```

3. Make sure there are no spaces around the `=` sign
4. Restart your backend server

### 2. "M-Pesa shortcode or passkey not configured"

**Error:** `Please add SHORTCODE and PASSKEY to .env`

**Solution:**
1. Get your passkey from [Safaricom Developer Portal](https://developer.safaricom.co.ke/)
2. Login to your Daraja account
3. Go to "My Apps" → Select your app
4. Find the "STK Push" section
5. Copy the **Pass Key**

### 3. "Invalid Kenyan phone number format"

**Error:** Phone number validation fails

**Solution:**
- Format must start with `254` (e.g., `254712345678`)
- Or start with `0` (e.g., `0712345678`) and it will be auto-converted
- Remove spaces and special characters

**Correct formats:**
- `254712345678` ✅
- `0712345678` ✅ (auto-converts to 254)
- `+254712345678` ✅ (remove + sign)
- `712345678` ❌ (needs country code)

### 4. "Failed to initiate M-Pesa payment"

**Error:** API returns error or fails to send STK Push

**Solution:**

#### Check Credentials:
```bash
# In your .env file, verify:
CONSUMER_KEY=your_consumer_key
CONSUMER_SECRET=your_consumer_secret
SHORTCODE=174379
PASSKEY=your_passkey
CALLBACK_URL=http://localhost:3000
```

#### Check Phone Number:
- Use test number: `254708374149`
- Ensure it starts with 254
- No spaces or special characters

#### Check Amount:
- Minimum: KSh 1
- Maximum: KSh 70,000
- Must be a number (not string)

### 5. "STK Push sent but no prompt received"

**Possible causes:**
1. Wrong phone number
2. Phone is offline
3. Payment request expired (60 seconds)
4. Insufficient M-Pesa balance
5. Phone not registered with M-Pesa

**Solution:**
- Double-check phone number format
- Ensure phone has internet/data
- Check M-Pesa balance
- Try again after 5 minutes

### 6. Callback Not Received

**Error:** Payment succeeds but transaction not updated in database

**Solution:**

1. **Use ngrok for local testing:**
```bash
# Install ngrok
npm install -g ngrok

# Start tunnel
ngrok http 3000

# Use the ngrok URL in .env
CALLBACK_URL=https://your-ngrok-url.ngrok.io
```

2. **Update Daraja Callback URL:**
- Login to Daraja portal
- Go to "My Apps" → Your app
- Update "Callback URL" to your ngrok URL

3. **Check server logs:**
```bash
# Look for callback requests in console
POST /api/payment/mpesa-callback
```

### 7. Access Token Issues

**Error:** "Error getting M-Pesa access token"

**Solution:**

1. **Check credentials in .env**
2. **Verify credentials are valid:**
   - Go to [Daraja Portal](https://developer.safaricom.co.ke/)
   - Check if your app is active
   - Regenerate credentials if expired

3. **Test OAuth endpoint manually:**
```bash
curl https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials \
  -H "Authorization: Basic <base64_encoded_credentials>"
```

### 8. MongoDB Connection Issues

**Error:** Transaction not saved to database

**Solution:**

1. **Check MongoDB is running:**
```bash
# Start MongoDB
mongod

# Or if using MongoDB as a service
sudo service mongod start
```

2. **Verify connection string in .env:**
```env
MONGO_URI=mongodb://localhost:27017/seekon-apparel
```

3. **Check backend logs for connection errors**

## 🧪 Testing Checklist

Before testing STK Push:

- [ ] MongoDB is running
- [ ] Backend server is running (`npm run dev` in `src/backend`)
- [ ] `.env` file has all M-Pesa credentials
- [ ] Using test phone number: `254708374149`
- [ ] Amount is between KSh 1 and 70,000
- [ ] Callback URL is accessible (use ngrok for local testing)

## 📊 Debug Logging

The updated controller now includes extensive logging:

- ✅ Success messages with green checkmarks
- ❌ Error messages with red X marks
- 📤 STK Push request details
- 🔄 API response data

Check your console for:
```
✅ M-Pesa access token retrieved successfully
📤 Sending STK Push request: { phone: '254708374149', amount: 100, reference: 'MPESA123...' }
✅ STK Push response: { ResponseCode: 0, ... }
```

## 🔍 Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 0 | Success | STK Push sent successfully |
| 1032 | Request cancelled by user | User cancelled payment |
| 1037 | Request timeout | User didn't respond in time |
| 1002 | Invalid credentials | Check API credentials |
| 1003 | Invalid phone number | Check phone format |

## 💡 Pro Tips

1. **Always test with sandbox credentials first**
2. **Use ngrok for local callback testing**
3. **Check server logs for detailed error messages**
4. **Test with known test numbers from Safaricom**
5. **Keep .env file secure, never commit to git**

## 🚀 Quick Test

1. Open your frontend checkout page
2. Enter phone: `254708374149`
3. Enter amount: `1` (KSh 1 - minimum)
4. Click "Pay with M-Pesa"
5. Check your phone for M-Pesa prompt
6. Enter PIN: `1234` (test PIN)
7. Confirm payment
8. Wait for callback (check backend logs)

## 📞 Still Having Issues?

1. Check [Safaricom Developer Forum](https://developer.safaricom.co.ke/)
2. Review [Daraja API Documentation](https://developer.safaricom.co.ke/docs)
3. Check backend logs in terminal
4. Verify all .env credentials are correct
5. Test with Postman or cURL




