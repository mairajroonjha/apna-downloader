@echo off
echo ===================================================
echo   Apna Downloader - SaaS Platform Local Test Suite
echo ===================================================
echo.

echo [1/3] Preparing Local SQLite D1 database schema...
call npx --prefix backend wrangler d1 execute apnadl-db -c backend/wrangler.toml --local --file=backend/schema.sql

echo [2/3] Starting Cloudflare Workers Local Server on Port 8787...
start "Apna DL Backend Server" npx --prefix backend wrangler dev -c backend/wrangler.toml --port 8787

echo.
echo Waiting 5 seconds for backend server to boot...
timeout /t 5 >nul

echo [3/3] Launching Electron Application...
npm start

echo.
echo Test suite process exited.
pause
