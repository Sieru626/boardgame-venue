@echo off
chcp 65001 >nul
cd /d %~dp0

echo ============================================
echo   デモページを開きます (サーバー不要)
echo ============================================
echo.

set "DEMO_PATH=%~dp0client\public\demo.html"
set "DEMO_DIR=%~dp0client\public"

if not exist "%DEMO_PATH%" (
    echo [エラー] demo.html が見つかりません
    echo %DEMO_PATH%
    pause
    exit /b 1
)

echo ブラウザで開いています...
start "" "%DEMO_PATH%"

echo.
echo デモページが開きました。
echo サーバー不要で file から直接表示されています。
echo.
pause
