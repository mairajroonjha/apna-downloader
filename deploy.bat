@echo off
echo Deploying Apna Downloader Backend to Cloudflare Workers...
cd /d "d:\apna dowanloader\backend"
npx wrangler deploy
echo.
echo ========================================================
echo Deployment finished! You can close this window.
echo ========================================================
pause
