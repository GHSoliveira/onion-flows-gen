@echo off
setlocal
title Reiniciar servidor Onion

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart-server.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERRO] Nao foi possivel reiniciar o servidor.
  pause
)

exit /b %EXIT_CODE%
