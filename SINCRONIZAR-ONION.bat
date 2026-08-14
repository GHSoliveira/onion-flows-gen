@echo off
setlocal EnableExtensions
title Onion Flows - Sincronizar e reparar

echo.
echo Um clique: GitHub, dependencias, interface e servidor.
echo A extensao e as paginas serao recarregadas automaticamente
echo quando o Onion local confirmar a nova versao.
echo.

call "%~dp0ATUALIZAR.bat" --local
exit /b %ERRORLEVEL%
