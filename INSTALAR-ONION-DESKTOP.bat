@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Onion Flows - Instalador para Windows

set "REPO_URL=https://github.com/GHSoliveira/onion-flows-gen.git"
set "REPO_FOLDER=onion-flows-gen"
set "CHECK_ONLY="
set "NEED_GIT="
set "NEED_NODE="
set "NODE_MAJOR="

if /I "%~1"=="--check" set "CHECK_ONLY=1"

echo.
echo ========================================================
echo   Onion Flows - Instalacao segura no Desktop
echo ========================================================
echo.

call :resolve_desktop
if errorlevel 1 goto :failure
set "TARGET_DIR=%DESKTOP_DIR%\%REPO_FOLDER%"

call :detect_requirements
if errorlevel 1 goto :failure

if defined CHECK_ONLY goto :check_report

if exist "%TARGET_DIR%" (
  echo [BLOQUEADO] A pasta de destino ja existe:
  echo   "%TARGET_DIR%"
  echo.
  echo Nenhum arquivo existente foi alterado.
  echo Se essa pasta ja for o Onion, use ATUALIZAR.bat dentro dela.
  goto :failure
)

if defined NEED_GIT (
  call :install_git
  if errorlevel 1 goto :failure
)

if defined NEED_NODE (
  call :install_node
  if errorlevel 1 goto :failure
)

call :refresh_tool_path

where git >nul 2>&1
if errorlevel 1 (
  echo [ERRO] O Git foi instalado, mas ainda nao esta disponivel neste terminal.
  echo Feche esta janela e execute o instalador novamente.
  goto :failure
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] O Node.js foi instalado, mas ainda nao esta disponivel neste terminal.
  echo Feche esta janela e execute o instalador novamente.
  goto :failure
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] O npm nao foi encontrado depois da instalacao do Node.js.
  echo Repare a instalacao do Node.js LTS e tente novamente.
  goto :failure
)

call :read_node_major
if errorlevel 1 goto :failure
if %NODE_MAJOR% LSS 20 (
  echo [ERRO] O Onion Flows exige Node.js 20 ou superior.
  echo Versao encontrada:
  node -v
  goto :failure
)

echo [1/3] Clonando a branch main no Desktop...
git clone --branch main --single-branch "%REPO_URL%" "%TARGET_DIR%"
if errorlevel 1 (
  echo [ERRO] O Git nao conseguiu clonar o repositorio.
  echo Confira a internet e o acesso ao GitHub.
  goto :failure
)

pushd "%TARGET_DIR%"

echo.
echo [2/3] Instalando dependencias do servidor...
if exist "package-lock.json" (
  call npm ci --no-audit --no-fund
) else (
  call npm install --no-audit --no-fund
)
if errorlevel 1 (
  popd
  echo [ERRO] Falha ao instalar as dependencias do servidor.
  echo O clone foi preservado em "%TARGET_DIR%" para diagnostico.
  goto :failure
)

echo.
echo [3/3] Instalando dependencias da interface...
pushd "client"
if exist "package-lock.json" (
  call npm ci --no-audit --no-fund
) else (
  call npm install --no-audit --no-fund
)
set "CLIENT_INSTALL_EXIT=%errorlevel%"
popd
if not "%CLIENT_INSTALL_EXIT%"=="0" (
  popd
  echo [ERRO] Falha ao instalar as dependencias da interface.
  echo O clone foi preservado em "%TARGET_DIR%" para diagnostico.
  goto :failure
)

popd

echo.
echo ========================================================
echo   Onion Flows instalado com sucesso
echo ========================================================
echo.
echo Pasta:
echo   "%TARGET_DIR%"
echo.
echo Proximo passo:
echo   Execute START.bat dentro dessa pasta.
echo.
start "" explorer.exe "%TARGET_DIR%"
pause
exit /b 0

:resolve_desktop
set "DESKTOP_DIR="
for /f "usebackq delims=" %%D in (`powershell.exe -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP_DIR=%%D"
if not defined DESKTOP_DIR set "DESKTOP_DIR=%USERPROFILE%\Desktop"
if not exist "%DESKTOP_DIR%" (
  echo [ERRO] Nao foi possivel localizar a Area de Trabalho do Windows.
  exit /b 1
)
exit /b 0

:detect_requirements
where git >nul 2>&1
if errorlevel 1 set "NEED_GIT=1"

where node >nul 2>&1
if errorlevel 1 goto :node_required
call :read_node_major
if errorlevel 1 goto :node_required
if %NODE_MAJOR% LSS 20 goto :node_required

where npm >nul 2>&1
if errorlevel 1 goto :node_required
exit /b 0

:node_required
set "NEED_NODE=1"
exit /b 0

:read_node_major
set "NODE_MAJOR="
for /f "usebackq delims=" %%V in (`node -p "parseInt(process.versions.node.split('.')[0], 10)" 2^>nul`) do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR exit /b 1
exit /b 0

:require_winget
where winget >nul 2>&1
if errorlevel 1 (
  echo [ERRO] O winget nao esta disponivel neste Windows.
  echo Instale o App Installer pela Microsoft Store e execute novamente.
  echo Nenhum instalador de site desconhecido sera baixado automaticamente.
  exit /b 1
)
exit /b 0

:install_git
call :require_winget
if errorlevel 1 exit /b 1
echo [REQUISITO] Instalando Git for Windows pelo winget...
winget install --id Git.Git --exact --source winget --accept-source-agreements --accept-package-agreements --silent
if errorlevel 1 (
  echo [ERRO] O winget nao conseguiu instalar o Git.
  exit /b 1
)
call :refresh_tool_path
exit /b 0

:install_node
call :require_winget
if errorlevel 1 exit /b 1
echo [REQUISITO] Instalando Node.js LTS com npm pelo winget...
winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements --silent
if errorlevel 1 (
  echo [ERRO] O winget nao conseguiu instalar o Node.js LTS.
  exit /b 1
)
call :refresh_tool_path
exit /b 0

:refresh_tool_path
set "PATH=%PATH%;%ProgramFiles%\Git\cmd;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\Git\cmd;%APPDATA%\npm"
exit /b 0

:check_report
echo [CHECK] Nenhuma instalacao ou clonagem sera executada.
echo.
if defined NEED_GIT (
  echo Git:      seria instalado pelo winget.
) else (
  echo Git:      encontrado.
  git --version
)
if defined NEED_NODE (
  echo Node/npm: Node.js LTS com npm seria instalado ou atualizado pelo winget.
) else (
  echo Node:     encontrado.
  node -v
  echo npm:      encontrado.
  call npm -v
)
echo Destino:  "%TARGET_DIR%"
if exist "%TARGET_DIR%" (
  echo Resultado: bloqueado porque a pasta de destino ja existe.
) else (
  echo Resultado: pronto para instalar.
)
echo.
echo [OK] Verificacao concluida sem alterar o computador.
exit /b 0

:failure
echo.
echo A instalacao nao foi concluida.
pause
exit /b 1
