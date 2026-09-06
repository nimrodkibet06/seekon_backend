# Start Backend Server
Write-Host "Starting Seekon Backend Server..." -ForegroundColor Green
Write-Host "Make sure MongoDB is running on port 27017" -ForegroundColor Yellow

# Check if .env exists
if (-not (Test-Path .env)) {
    Write-Host "ERROR: .env file not found!" -ForegroundColor Red
    Write-Host "Please create .env file with your credentials" -ForegroundColor Yellow
    exit 1
}

# Install dependencies if needed
if (-not (Test-Path node_modules)) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm install
}

# Start server
Write-Host "`n✅ Starting server on http://localhost:3000`n" -ForegroundColor Green
npm run dev




