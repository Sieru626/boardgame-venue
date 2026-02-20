@echo off
chcp 65001 >nul
cd /d %~dp0

echo ============================================
echo   Board Game Venue 起動 (Port 3010)
echo ============================================
echo.

if not exist "server\.env" (
    echo [注意] server\.env がありません。
    echo 先に setup.bat を実行してください。
    echo.
    pause
    exit /b 1
)

if not exist "server\node_modules" (
    echo 依存関係をインストール中...
    cd server
    call npm install
    cd ..
)

if not exist "client\node_modules" (
    cd client
    call npm install
    cd ..
)

echo サーバーを起動中...
start "BoardGame Venue" cmd /k "cd /d %~dp0server && set PORT=3010 && node index.js"

echo 起動を待っています (最大90秒)...
set /a retries=0

:CHECK
set /a retries+=1
if %retries% geq 30 (
    echo.
    echo [INFO] タイムアウト: 手動で http://localhost:3010/demo を開いてください
    goto OPEN
)

timeout /t 3 >nul
netstat -ano 2>nul | findstr ":3010" | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo ... 待機中 [%retries%/30]
    goto CHECK
)

:OPEN
echo.
echo ブラウザを開きます...
timeout /t 2 >nul
start "" "http://localhost:3010/demo"

echo.
echo ============================================
echo   デモ: http://localhost:3010/demo
echo   デモのみ見る: open-demo.bat
echo   停止: BoardGame Venue ウィンドウを閉じる
echo   サーバー再起動: restart-server.bat (再起動後はルームで自動再接続)
echo ============================================
pause
