@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Onion Flows - Parar Sandbox
echo Encerrando sandbox...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-sandbox.ps1"
echo.
echo Finalizado.
pause
