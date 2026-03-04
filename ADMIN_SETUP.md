# Admin Dashboard Setup Guide

## 🚀 Quick Start

### 1. Create Admin User

Run the following command to create a default admin user:

```bash
cd src/backend
npm run create-admin
```

**Default Credentials:**
- Email: `admin@seekon.com`
- Password: `admin123`

### 2. Access Admin Dashboard

1. Go to: **http://localhost:5177/admin/login**
2. Login with credentials above
3. You'll be redirected to the dashboard

---

## 📊 Dashboard Features

### Dashboard Overview
- Real-time stats (Today's Revenue, Successful, Failed, Pending)
- Total revenue tracking
- Weekly revenue charts
- Auto-refresh every 10 seconds

### Transactions View
- Search by phone number, email, or reference
- Filter by status (Completed, Pending, Failed)
- Export to CSV
- View transaction details

### Routes

| Route | Description |
|-------|-------------|
| `/admin/login` | Admin login page |
| `/admin/dashboard` | Dashboard overview with stats |
| `/admin/transactions` | View all transactions |

---

## 🔐 Admin API Endpoints

### Login
```bash
POST /api/admin/login
Body: { email, password }
Response: { token, admin: { id, email, role } }
```

### Dashboard Stats
```bash
GET /api/admin/stats
Headers: { Authorization: Bearer <token> }
Response: { today: {...}, total: {...}, weeklyRevenue: [...] }
```

### Get Transactions
```bash
GET /api/admin/transactions?page=1&limit=50&status=completed&search=254
Headers: { Authorization: Bearer <token> }
Response: { transactions: [...], pagination: {...} }
```

### Export Transactions
```bash
GET /api/admin/transactions/export/csv?status=completed
Headers: { Authorization: Bearer <token> }
Response: CSV file download
```

---

## 🎨 Frontend Components

### Pages Created
- ✅ `AdminLogin.jsx` - Login with glassmorphic design
- ✅ `AdminDashboard.jsx` - Stats cards and charts
- ✅ `AdminTransactions.jsx` - Transaction table with filters

### Features
- ✅ Real-time updates (auto-refresh)
- ✅ Search and filter functionality
- ✅ CSV export
- ✅ Status color coding
- ✅ Responsive design
- ✅ Framer Motion animations

---

## 🔒 Security

### Protected Routes
All admin routes require JWT authentication:
```javascript
const token = localStorage.getItem('adminToken');
```

### Token Expiry
JWT tokens expire after 24 hours

### Admin Middleware
```javascript
router.use('/admin/stats', authMiddleware, getDashboardStats);
```

---

## 🧪 Testing

### Test Login
```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@seekon.com","password":"admin123"}'
```

### Get Stats (with token)
```bash
curl http://localhost:3000/api/admin/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🎯 Next Steps

1. **Create Admin User**: Run `npm run create-admin`
2. **Login**: Go to http://localhost:5177/admin/login
3. **Monitor Payments**: View real-time transaction dashboard
4. **Export Data**: Download transaction reports
5. **Analyze**: Review payment trends and stats

---

## 💡 Features to Add

- [ ] Real-time notifications (Socket.io)
- [ ] Advanced analytics charts
- [ ] User management
- [ ] Audit logs
- [ ] Multi-admin support
- [ ] Custom date range filters
- [ ] Payment reconciliation reports

---

## 🎉 Ready to Use!

Your admin dashboard is now fully functional and ready to monitor M-Pesa payments!




