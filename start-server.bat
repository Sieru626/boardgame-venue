@echo off
chcp 65001 >nul
echo ========================================
echo  BoardGame Venue サーバー起動
echo ========================================
cd /d "%~dp0server"

echo 初回のみ: このフォルダで npm install を実行してください。
echo.

echo [1/2] Prisma クライアント確認...
call npx prisma generate 2>nul
if errorlevel 1 (
    echo Prisma generate でエラーが出ましたが、続行します。
)

echo.
echo [2/2] サーバー起動中 (PORT=3010)...
echo.
echo 起動できたらブラウザで開いてください: http://localhost:3010
echo 止めるときはこの窓で Ctrl+C を押してください。
echo.
set PORT=3010
node index.js

echo.
echo サーバーが終了しました。
pause
