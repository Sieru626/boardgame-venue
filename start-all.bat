@echo off
cd /d %~dp0

echo Starting Board Game Venue MVP...

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

echo Starting API Server...
start "BoardGame API" cmd /k "cd /d %~dp0server & npm start"

echo Starting Web Client...
start "BoardGame Web" cmd /k "cd /d %~dp0client & npm run dev"

echo Waiting for API Server to be ready (Port 3010)...
set /a retries=0

:CHECK_SERVER
set /a retries+=1
if %retries% geq 40 (
    echo.
    echo [ERROR] Timeout: Server did not start within 120 seconds.
    echo Please check the server console window for errors.
    pause
    exit /b 1
)

timeout /t 3 >nul
netstat -ano | findstr ":3010" | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo ... Waiting for Server ^(3010^) [Attempt %retries%/40] ...
    goto CHECK_SERVER
)

echo.
echo ===================================================
echo   Server is UP! Waiting 20s for Client to build...
echo ===================================================
timeout /t 20

echo.
echo Opening Game [http://localhost:3000]...
start http://localhost:3000

echo.
echo Done! Servers are running.
echo To stop, close the command prompt windows.
pause
