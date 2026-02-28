@echo off
chcp 65001 >nul
cd /d %~dp0

:: server\.env が無ければ自動作成
if not exist "server\.env" (
    if exist ".env.example" (copy ".env.example" "server\.env" >nul) else (echo PORT=3010> server\.env && echo DATABASE_URL="file:./dev.db">> server\.env)
)
if not exist "client\.env.local" (echo NEXT_PUBLIC_SOCKET_URL=http://localhost:3010> client\.env.local)
if not exist "server\node_modules" (cd server && call npm install && cd ..)
if not exist "client\node_modules" (cd client && call npm install && cd ..)

:: 既に起動中なら何もしない
netstat -ano 2>nul | findstr ":3010" | findstr "LISTENING" >nul
if %errorlevel% equ 0 exit /b 0

:: サーバーを最小化で起動（ウィンドウは残すが目立たない）
start "BoardGame Venue" /min cmd /k "cd /d %~dp0server && set PORT=3010 && node index.js"
exit /b 0
