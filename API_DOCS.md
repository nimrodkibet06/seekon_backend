# 📚 Seekon Backend API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication
Most endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 🔐 Auth Endpoints

### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user"
  }
}
```

---

### Login User
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user"
  }
}
```

---

### Get Current User
```http
GET /api/auth/me
Authorization: Bearer YOUR_JWT_TOKEN
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "profilePhoto": "",
    "phoneNumber": "",
    "address": ""
  }
}
```

---

## 📤 Upload Endpoints

### Upload File
```http
POST /api/upload
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: multipart/form-data

file: [binary file data]
```

**Response:**
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "url": "https://res.cloudinary.com/.../image.jpg",
    "publicId": "seekon-apparel/image-1234567890"
  }
}
```

---

### Delete File
```http
DELETE /api/upload/:publicId
Authorization: Bearer YOUR_JWT_TOKEN
```

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

---

## 💳 Payment Endpoints

### STK Push (M-Pesa)
```http
POST /api/payment/stk-push
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "phoneNumber": "0712345678",
  "amount": 100
}
```

**Response:**
```json
{
  "success": true,
  "message": "STK Push initiated successfully",
  "data": {
    "MerchantRequestID": "...",
    "CheckoutRequestID": "...",
    "ResponseCode": "0",
    "ResponseDescription": "Success"
  }
}
```

---

### Payment Callback
```http
POST /api/payment/callback
Content-Type: application/json

[Callback data from Safaricom]
```

---

## ❌ Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Please provide all fields"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Route not found"
}
```

### 500 Server Error
```json
{
  "success": false,
  "message": "Something went wrong!"
}
```

---

## 📝 Notes

- All passwords are hashed with bcrypt (salt rounds: 10)
- JWT tokens expire in 7 days
- Phone numbers should be in format: `0712345678` or `254712345678`
- File uploads limited to 5MB
- Only image files allowed (jpeg, jpg, png, gif, webp)
- Daraja uses Safaricom sandbox for testing




