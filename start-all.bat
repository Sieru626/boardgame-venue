@echo off
cd /d %~dp0

echo Starting Board Game Venue MVP (Port 3010 only - 3000 is used by 成立たせ屋本舗)

if not exist "server\node_modules" (
    echo Installing Server Dependencies...
    cd server
    call npm install
    cd ..
)

if not exist "client\node_modules" (
    echo Installing Client Dependencies...
    cd client
    call npm install
    cd ..
)

echo Starting Server (API + Web on Port 3010)...
start "BoardGame Venue" cmd /k "cd /d %~dp0server && npm start"

echo Waiting for Server to be ready (Port 3010)...
set /a retries=0

:CHECK_SERVER
set /a retries+=1
if %retries% geq 50 (
    echo.
    echo [ERROR] Timeout: Server did not start within 150 seconds.
    echo Please check the server console window for errors.
    pause
    exit /b 1
)

timeout /t 3 >nul
netstat -ano | findstr ":3010" | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo ... Waiting for Server ^(3010^) [Attempt %retries%/50] ...
    goto CHECK_SERVER
)

echo.
echo ===================================================
echo   Server is UP! Waiting for Next.js to be ready...
echo ===================================================
timeout /t 15

echo.
echo Opening Game [http://localhost:3010]
start http://localhost:3010

echo.
echo Done! Use only http://localhost:3010 (do not use 3000).
echo To stop, close the "BoardGame Venue" window.
pause
