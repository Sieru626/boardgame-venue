@echo off
echo Starting BoardGame Venue (MVP)...

echo Starting Server (Port 3010)...
start "BGV Server" cmd /k "cd server && node index.js"

echo Starting Client (Port 3000)...
start "BGV Client" cmd /k "cd client && npm run dev"

echo Waiting for services to start (5 seconds)...
timeout /t 5 >nul

echo Opening Browser...
start http://localhost:3000

echo System is running!
echo If you need to stop, just close the terminal windows.
pause
