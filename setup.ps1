# Seekon Backend Setup Script
Write-Host "🚀 Seekon Backend Setup" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if MongoDB is running
Write-Host "Step 1: Checking MongoDB connection..." -ForegroundColor Yellow
try {
    $mongoTest = Test-NetConnection -ComputerName localhost -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($mongoTest) {
        Write-Host "✅ MongoDB is running" -ForegroundColor Green
    } else {
        Write-Host "⚠️  MongoDB might not be running. Please start it with: mongod" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Could not check MongoDB. Continuing anyway..." -ForegroundColor Yellow
}

Write-Host ""

# Step 2: Install dependencies
Write-Host "Step 2: Installing dependencies..." -ForegroundColor Yellow
npm install
Write-Host "✅ Dependencies installed" -ForegroundColor Green
Write-Host ""

# Step 3: Create admin user
Write-Host "Step 3: Creating admin user..." -ForegroundColor Yellow
node src/scripts/createAdmin.js
Write-Host ""

# Step 4: Start server
Write-Host "Step 4: Starting backend server..." -ForegroundColor Yellow
Write-Host "✅ Server should be running on http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "📧 Admin Credentials:" -ForegroundColor Cyan
Write-Host "   Email: admin@seekon.com" -ForegroundColor White
Write-Host "   Password: admin123" -ForegroundColor White
Write-Host ""
Write-Host "🌐 Admin Dashboard: http://localhost:5177/admin/login" -ForegroundColor Cyan
Write-Host ""

npm run dev




