@echo off
REM Double-clickable launcher. Runs start.ps1 with execution policy bypass
REM so you don't need to configure PowerShell first.
setlocal
cd /d "%~dp0"
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0start.ps1"
