@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title OnionFlows - Atualizar pelo GitHub

set "AUTO_MODE="
set "UPDATE_REQUEST_ID=%~2"
set "UPDATE_STATUS=%~dp0sandbox\update-status.txt"
if /I "%~1"=="--auto" set "AUTO_MODE=1"
if defined AUTO_MODE (
  if not exist "%~dp0sandbox" mkdir "%~dp0sandbox" >nul 2>&1
  >"%UPDATE_STATUS%" echo running^|%UPDATE_REQUEST_ID%
)

echo.
echo ========================================================
echo   OnionFlows - Atualizacao segura pelo GitHub
echo ========================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Git nao foi encontrado no PATH.
  echo Instale o Git para Windows e tente novamente.
  goto :falha
)

if not exist ".git" (
  echo [ERRO] Esta pasta nao e um clone Git.
  echo Execute este arquivo na raiz do repositorio OnionFlows.
  goto :falha
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo [ERRO] O remoto "origin" nao esta configurado.
  goto :falha
)

set "ALTERACOES_LOCAIS="
for /f "delims=" %%L in ('git status --porcelain 2^>nul') do set "ALTERACOES_LOCAIS=1"
if defined ALTERACOES_LOCAIS (
  echo [BLOQUEADO] Existem alteracoes locais nesta pasta.
  echo.
  git status --short
  echo.
  echo Salve essas alteracoes em um commit ou remova-as antes de atualizar.
  echo Nenhum arquivo foi alterado pelo atualizador.
  goto :falha
)

for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "BRANCH_ATUAL=%%B"
if /I not "%BRANCH_ATUAL%"=="main" (
  echo [BLOQUEADO] A branch atual e "%BRANCH_ATUAL%".
  echo Troque para a branch main antes de atualizar.
  goto :falha
)

for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "HEAD_ANTIGO=%%H"
if not defined HEAD_ANTIGO (
  echo [ERRO] Nao foi possivel identificar a versao local.
  goto :falha
)

echo Buscando atualizacoes da branch main...
git fetch --prune origin main
if errorlevel 1 (
  echo.
  echo [ERRO] Falha ao consultar o GitHub. Confira a internet e o acesso ao repositorio.
  goto :falha
)

git merge --ff-only origin/main
if errorlevel 1 (
  echo.
  echo [BLOQUEADO] O historico local divergiu do GitHub.
  echo O atualizador nao cria merge automatico e nao apaga arquivos.
  echo Resolva o historico manualmente antes de tentar novamente.
  goto :falha
)

for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "HEAD_NOVO=%%H"
if /I "%HEAD_ANTIGO%"=="%HEAD_NOVO%" (
  echo.
  echo [OK] O OnionFlows ja esta atualizado.
  goto :sucesso
)

set "ATUALIZAR_BACKEND="
set "ATUALIZAR_FRONTEND="
for /f "delims=" %%F in ('git diff --name-only "%HEAD_ANTIGO%" "%HEAD_NOVO%"') do (
  if /I "%%F"=="package.json" set "ATUALIZAR_BACKEND=1"
  if /I "%%F"=="package-lock.json" set "ATUALIZAR_BACKEND=1"
  if /I "%%F"=="client/package.json" set "ATUALIZAR_FRONTEND=1"
  if /I "%%F"=="client/package-lock.json" set "ATUALIZAR_FRONTEND=1"
)

if defined ATUALIZAR_BACKEND (
  echo.
  echo Atualizando dependencias do servidor...
  call npm install
  if errorlevel 1 (
    echo [ERRO] Nao foi possivel atualizar as dependencias do servidor.
    goto :falha_pos_merge
  )
)

if defined ATUALIZAR_FRONTEND (
  echo.
  echo Atualizando dependencias da interface...
  pushd client
  call npm install
  set "NPM_FRONTEND_ERRO=!errorlevel!"
  popd
  if not "!NPM_FRONTEND_ERRO!"=="0" (
    echo [ERRO] Nao foi possivel atualizar as dependencias da interface.
    goto :falha_pos_merge
  )
)

echo.
echo Reiniciando o OnionFlows com a nova versao...
call "%~dp0STOP.bat" <nul
call "%~dp0START.bat" <nul
if errorlevel 1 (
  echo.
  echo [ERRO] A atualizacao foi instalada, mas o OnionFlows nao iniciou corretamente.
  echo Execute START.bat para ver o diagnostico completo.
  goto :falha_pos_merge
)

for /f "delims=" %%H in ('git rev-parse --short "%HEAD_ANTIGO%" 2^>nul') do set "VERSAO_ANTIGA=%%H"
for /f "delims=" %%H in ('git rev-parse --short "%HEAD_NOVO%" 2^>nul') do set "VERSAO_NOVA=%%H"
echo.
echo [OK] OnionFlows atualizado: !VERSAO_ANTIGA! -^> !VERSAO_NOVA!

:sucesso
echo.
if defined AUTO_MODE (
  >"%UPDATE_STATUS%" echo success^|%UPDATE_REQUEST_ID%^|!HEAD_ANTIGO!^|!HEAD_NOVO!
) else (
  pause
)
exit /b 0

:falha_pos_merge
echo.
echo O codigo novo permanece instalado; nenhum reset automatico foi executado.

:falha
echo.
if defined AUTO_MODE (
  >"%UPDATE_STATUS%" echo failed^|%UPDATE_REQUEST_ID%^|update_failed
) else (
  pause
)
exit /b 1
