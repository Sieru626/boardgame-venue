@echo off
chcp 65001 >nul
cd /d %~dp0

title Board Game Venue - 起動中

:: server\.env が無ければ .env.example から自動作成
if not exist "server\.env" (
    echo [初回] server\.env を作成しています...
    if exist ".env.example" (
        copy ".env.example" "server\.env" >nul
        echo server\.env を作成しました。
    ) else (
        echo PORT=3010> server\.env
        echo DATABASE_URL="file:./dev.db">> server\.env
        echo server\.env を自動作成しました。
    )
)

:: client\.env.local が無ければ作成（ソケット接続用）
if not exist "client\.env.local" (
    echo [初回] client\.env.local を作成しています...
    echo NEXT_PUBLIC_SOCKET_URL=http://localhost:3010> client\.env.local
    echo client\.env.local を作成しました。
)

:: 依存関係が無ければインストール
if not exist "server\node_modules" (
    echo [初回] server の依存関係をインストールしています...
    cd server
    call npm install
    cd ..
)
if not exist "client\node_modules" (
    echo [初回] client の依存関係をインストールしています...
    cd client
    call npm install
    cd ..
)

:: 既にポート 3010 で待ち受けていればブラウザだけ開く
netstat -ano 2>nul | findstr ":3010" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo サーバーは既に起動しています。ブラウザを開きます...
    start "" "http://localhost:3010/"
    timeout /t 2 >nul
    exit /b 0
)

:: サーバーを別ウィンドウで起動（このウィンドウは閉じない）
echo サーバーを起動しています...
start "BoardGame Venue" cmd /k "cd /d %~dp0server && set PORT=3010 && node index.js"

:: 起動完了を待つ（最大 90 秒）
echo 起動を待っています...
set /a retries=0
:WAIT
set /a retries+=1
if %retries% geq 45 (
    echo タイムアウトしました。ブラウザを開きます。表示されない場合は「BoardGame Venue」ウィンドウのエラーを確認してください。
    goto OPEN_BROWSER
)
timeout /t 2 >nul
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:3010/api/health' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&nul
if %errorlevel% neq 0 (
    echo ... 待機中 [%retries%/45]
    goto WAIT
)

:OPEN_BROWSER
echo.
echo ブラウザを開きます: http://localhost:3010/
start "" "http://localhost:3010/"
timeout /t 2 >nul
echo.
echo 起動しました。このウィンドウは閉じて構いません。
echo サーバーを止める場合は「BoardGame Venue」ウィンドウを閉じてください。
timeout /t 3 >nul
exit /b 0
