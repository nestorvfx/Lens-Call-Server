@echo off
echo ============================================
echo Face Tracker WebSocket Server Setup
echo ============================================

cd /d "%~dp0server"

if not exist "node_modules" (
    echo Installing Node.js dependencies...
    npm install
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies
        echo Make sure Node.js is installed: https://nodejs.org/
        pause
        exit /b 1
    )
)

echo.
echo ============================================
echo Starting Face Tracker WebSocket Server
echo ============================================
echo Server will run on: http://localhost:3000
echo Health check: http://localhost:3000/health
echo.
echo Press Ctrl+C to stop the server
echo ============================================
echo.

npm run dev
