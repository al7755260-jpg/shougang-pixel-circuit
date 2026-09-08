@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动外网联机.ps1"
if errorlevel 1 pause
