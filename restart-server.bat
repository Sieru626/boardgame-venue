@echo off
chcp 65001 >nul
cd /d %~dp0

echo ============================================
echo   サーバー再起動 (Port 3010)
echo ============================================
echo.

:: Port 3010 で LISTEN しているプロセスを終了
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3010" ^| findstr "LISTENING"') do (
    echo プロセス %%a を終了しています...
    taskkill /PID %%a /F 2>nul
)

timeout /t 2 >nul
echo.
echo サーバーを起動し直しています...
start "BoardGame Venue" cmd /k "cd /d %~dp0server && set PORT=3010 && node index.js"

echo 起動を待っています (最大60秒)...
set /a retries=0

:CHECK
set /a retries+=1
if %retries% geq 20 (
    echo.
    echo [INFO] タイムアウト: 手動で http://localhost:3010 を開いてください
    goto OPEN
)

timeout /t 3 >nul
netstat -ano 2>nul | findstr ":3010" | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo ... 待機中 [%retries%/20]
    goto CHECK
)

:OPEN
echo.
echo サーバーが起動しました。
echo ルームページを開いたままにしていれば、自動で再接続して入り直します。
echo ブラウザを開きますか？ (トップページ)
timeout /t 2 >nul
start "" "http://localhost:3010"

echo.
echo ============================================
echo   トップ: http://localhost:3010
echo   ルームにいる場合はそのまま待つと自動再接続します
echo ============================================
pause
