# Seekon Backend API

Backend API for Seekon Apparel using Node.js, Express, MongoDB, Cloudinary, and Daraja..

## 🚀 Features

- **Authentication**: JWT-based auth with bcrypt password hashing
- **File Upload**: Multer + Cloudinary for image storage
- **Payment**: Daraja (Safaricom M-Pesa) STK Push integration
- **Database**: MongoDB with Mongoose
- **Security**: JWT tokens, bcrypt, CORS protection

## 📁 Project Structure

```
src/
 ├── config/
 │   ├── db.js              # MongoDB connection
 │   └── cloudinary.js      # Cloudinary configuration
 ├── controllers/
 │   ├── authController.js  # Auth logic (register, login)
 │   ├── uploadController.js # File upload handling
 │   └── paymentController.js # Daraja payment integration
 ├── middleware/
 │   ├── auth.js            # JWT verification middleware
 │   └── upload.js          # Multer configuration
 ├── models/
 │   └── User.js            # User schema
 ├── routes/
 │   ├── authRoutes.js      # Auth endpoints
 │   ├── uploadRoutes.js    # Upload endpoints
 │   ├── paymentRoutes.js   # Payment endpoints
 │   └── index.js           # Route aggregator
 └── server.js              # Main server file
```

## 🛠️ Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   - Copy `env.example.txt` to `.env`
   - Fill in your MongoDB URI, JWT secret, Cloudinary credentials, and Daraja credentials

3. **Start the server:**
   ```bash
   npm run dev
   ```

## 🔑 Environment Variables

Create a `.env` file with:

```env
MONGO_URI=mongodb://localhost:27017/seekon-apparel
JWT_SECRET=your_super_secret_jwt_key
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
DARAJA_CONSUMER_KEY=your_consumer_key
DARAJA_CONSUMER_SECRET=your_consumer_secret
DARAJA_BUSINESS_SHORTCODE=174379
DARAJA_PASS_KEY=your_passkey
PORT=3000
```

## 📡 API Endpoints

### Authentication (`/api/auth`)

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user (requires auth)

### Upload (`/api/upload`)

- `POST /api/upload` - Upload file to Cloudinary (requires auth)
- `DELETE /api/upload/:publicId` - Delete file from Cloudinary (requires auth)

### Payment (`/api/payment`)

- `POST /api/payment/stk-push` - Initiate M-Pesa STK Push (requires auth)
- `POST /api/payment/callback` - M-Pesa callback handler

## 🔐 Usage Examples

### Register
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","password":"password123"}'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"password123"}'
```

### Upload File
```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@image.jpg"
```

### STK Push
```bash
curl -X POST http://localhost:3000/api/payment/stk-push \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"0712345678","amount":100}'
```

## 🧪 Testing

Make sure MongoDB is running locally:
```bash
mongod
```

Then start the server:
```bash
npm run dev
```

Visit `http://localhost:3000` to see the API status.

## 📝 Notes

- Uses ES Modules (import/export syntax)
- All passwords are hashed with bcrypt
- JWT tokens expire in 7 days
- File uploads are limited to 5MB
- Cloudinary handles automatic image optimization
- Daraja integration uses Safaricom sandbox environment




