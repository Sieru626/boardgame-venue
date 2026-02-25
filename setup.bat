@echo off
chcp 65001 >nul
cd /d %~dp0

echo ============================================
echo   初回セットアップ (1回だけ実行)
echo ============================================
echo.

REM server/.env が無ければ作成
if not exist "server\.env" (
    echo server\.env を作成中...
    (
        echo PORT=3010
        echo NODE_ENV=development
        echo DATABASE_URL="file:./prisma/dev.db"
        echo GEMINI_API_KEY=
    ) > server\.env
    echo OK
) else (
    echo server\.env は既に存在します
)

REM 依存関係
if not exist "server\node_modules" (
    echo サーバーの依存関係をインストール中...
    cd server
    call npm install
    cd ..
)

if not exist "client\node_modules" (
    echo クライアントの依存関係をインストール中...
    cd client
    call npm install
    cd ..
)

echo.
echo データベースを初期化中...
cd server
call npx prisma db push 2>nul
if not exist "prisma\dev.db" (
    echo Prisma 失敗 - sql.js で DB を作成します...
    call npm install sql.js --no-save 2>nul
    call node init-db.js
)
cd ..

echo.
echo ============================================
echo   Setup complete.
echo   Run start-all.bat to start server
echo   Run open-demo.bat to open demo
echo ============================================
pause
