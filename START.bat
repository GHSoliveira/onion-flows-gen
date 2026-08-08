@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Onion Flows - Sandbox Local
echo ============================================
echo  Onion Flows - Sandbox Local
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo Instale Node.js 20+ em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERRO] npm nao encontrado no PATH.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo Node: %%v
set "NODE_MAJOR="
for /f "tokens=*" %%v in ('node -p "parseInt(process.versions.node)"') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR (
  echo [ERRO] Nao foi possivel identificar a versao do Node.js.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 20 (
  echo [ERRO] Node.js 20+ obrigatorio. Versao encontrada: %NODE_MAJOR%.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('npm -v') do echo npm:  %%v
echo.

if not exist "package.json" (
  echo [ERRO] package.json nao encontrado. Rode este BAT na raiz do projeto.
  pause
  exit /b 1
)

echo [CONFIG] Validando configuracao local...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-sandbox-env.ps1"
if errorlevel 1 (
  echo [ERRO] Nao foi possivel preparar o arquivo .env.sandbox.
  pause
  exit /b 1
)
echo.

echo [TRANSCRICAO] Validando mecanismo local gratuito...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local-transcription.ps1" -InstallMissingRuntime
if errorlevel 1 (
  echo [AVISO] O Onion continuara funcionando, mas a transcricao local ficou indisponivel.
  echo Execute START.bat novamente para tentar instalar esse recurso.
)
echo.

if not exist "node_modules\" (
  echo [1/3] Instalando dependencias do backend...
  call npm install
  if errorlevel 1 (
    echo [ERRO] npm install do backend falhou.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Backend ja instalado.
)

if not exist "client\node_modules\" (
  echo [2/3] Instalando dependencias do frontend...
  pushd client
  call npm install
  if errorlevel 1 (
    popd
    echo [ERRO] npm install do frontend falhou.
    pause
    exit /b 1
  )
  popd
) else (
  echo [2/3] Frontend ja instalado.
)

echo [3/3] Subindo e verificando sandbox...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-sandbox.ps1"
if errorlevel 1 (
  echo.
  echo [ERRO] O sandbox nao iniciou. O diagnostico foi mostrado acima.
  echo Logs completos: %~dp0sandbox\logs\
  pause
  exit /b 1
)

echo.
echo ============================================
echo  Pronto - servicos verificados!
echo  Frontend: http://127.0.0.1:3101
echo  API:      http://127.0.0.1:3101
echo  Health:   http://127.0.0.1:3101/health
echo.
echo  Login: admin / sandbox123  (super-admin)
echo         agent / sandbox123  (agente)
echo.
echo  Para parar: STOP.bat
echo ============================================
echo.
pause
