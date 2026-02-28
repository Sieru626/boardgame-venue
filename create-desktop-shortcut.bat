@echo off
chcp 65001 >nul
cd /d %~dp0

set "PROJECT_DIR=%~dp0"
set "OPEN_BAT=%PROJECT_DIR%OPEN.bat"
set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT_PATH=%DESKTOP%\Board Game Venue を開く.lnk"

echo デスクトップに「Board Game Venue を開く」ショートカットを作成しています...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ws = New-Object -ComObject WScript.Shell;" ^
 "$s = $ws.CreateShortcut('%SHORTCUT_PATH%');" ^
 "$s.TargetPath = '%OPEN_BAT%';" ^
 "$s.WorkingDirectory = '%PROJECT_DIR:~0,-1%';" ^
 "$s.WindowStyle = 1;" ^
 "$s.Description = 'Board Game Venue (http://localhost:3010)';" ^
 "$s.Save(); Write-Host '作成しました: デスクトップの「Board Game Venue を開く」をダブルクリックで起動できます。'"

echo.
pause
