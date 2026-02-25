@echo off
chcp 65001 >nul
cd /d %~dp0

REM run-demo = open-demo と同じ（確実にファイルを直接開く）
call open-demo.bat
