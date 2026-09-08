@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动游戏.ps1" -PV
if errorlevel 1 pause
