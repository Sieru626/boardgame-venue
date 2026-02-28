@echo off
chcp 65001 >nul
cd /d %~dp0

set "PROJECT_DIR=%~dp0"
set "BAT_PATH=%PROJECT_DIR%start-server-background.bat"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\Board Game Venue サーバー起動.lnk"

echo ============================================
echo   Board Game Venue - スタートアップ登録
echo ============================================
echo.
echo 登録すると、Windows にログインするたびに
echo サーバーが自動で起動します。
echo その後は http://localhost:3010/ を開くだけで利用できます。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ws = New-Object -ComObject WScript.Shell;" ^
 "$s = $ws.CreateShortcut('%SHORTCUT_PATH%');" ^
 "$s.TargetPath = '%BAT_PATH%';" ^
 "$s.WorkingDirectory = '%PROJECT_DIR:~0,-1%';" ^
 "$s.WindowStyle = 7;" ^
 "$s.Description = 'Board Game Venue (localhost:3010)';" ^
 "$s.Save(); Write-Host 'スタートアップに登録しました。'; Write-Host ''; Write-Host '次回ログインからサーバーが自動起動します。'; Write-Host '今すぐサーバーを起動してブラウザを開く場合は OPEN.bat を実行してください。'"

echo.
pause
