@echo off
echo ===================================================
echo   Board Game Venue MVP - START ALL
echo ===================================================

echo [1/4] Cleaning up previous processes...
taskkill /F /IM node.exe >nul 2>&1

echo [2/4] Removing lock files...
if exist "client\.next\dev\lock" del "client\.next\dev\lock"

echo [3/4] Starting API Server (Port 4001)...
start "API Server" cmd /c "cd server && npm start"

echo [4/4] Starting Web Client (Port 3010)...
start "Web Client" cmd /c "cd client && npm run dev"

echo.
echo Waiting for servers to initialize...
timeout /t 10

echo Opening Browser...
start http://localhost:3010

echo.
echo ===================================================
echo   System Started!
echo   Web: http://localhost:3010
echo   API: http://localhost:4001
echo ===================================================
echo.
pause
