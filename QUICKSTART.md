# 🚀 Quick Start Guide

## Prerequisites

- Node.js installed
- MongoDB running (or connection string)
- Cloudinary account (for file uploads)
- Daraja credentials (for M-Pesa payments)

## Setup Steps

### 1. Configure Environment

Copy the example environment file:
```bash
copy env.example.txt .env
```

Edit `.env` with your credentials:
- MongoDB connection string
- JWT secret (any long random string)
- Cloudinary credentials
- Daraja (M-Pesa) credentials

### 2. Install Dependencies

Already done! ✅

### 3. Start MongoDB

Make sure MongoDB is running:
```bash
mongod
```

Or use MongoDB Atlas connection string in `.env`.

### 4. Start the Server

```bash
npm run dev
```

Server will start on `http://localhost:3000`

### 5. Test the API

Visit `http://localhost:3000` in your browser to see:
```json
{
  "success": true,
  "message": "✅ Seekon Backend API is running...",
  "version": "1.0.0"
}
```

## Test Registration

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test User\",\"email\":\"test@seekon.com\",\"password\":\"test123\"}"
```

## Next Steps

- Test authentication endpoints
- Upload files to Cloudinary
- Test M-Pesa payments (STK Push)
- Connect frontend to backend API

## Troubleshooting

**Port already in use:**
Change `PORT` in `.env` file

**MongoDB connection failed:**
Check MongoDB is running and `MONGO_URI` is correct

**Cloudinary errors:**
Verify credentials in `.env`

**Daraja errors:**
Use sandbox credentials for testing




