@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "APP_DIR=%~dp0"
set "ZIP_NAME=OnionFlows-Sandbox-Local.zip"
set "ZIP_PATH=%APP_DIR%%ZIP_NAME%"

echo ============================================
echo  Limpar dependencias e compactar aplicacao
echo ============================================
echo.
echo Pasta: %APP_DIR%
echo.
echo Este processo vai apagar somente:
echo   - %APP_DIR%node_modules
echo   - %APP_DIR%client\node_modules
echo.
choice /C SN /N /M "Deseja continuar? [S/N]: "
if errorlevel 2 (
  echo Operacao cancelada.
  exit /b 0
)

echo.
echo [1/4] Parando backend e frontend para liberar os arquivos...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\stop-sandbox.ps1"
if errorlevel 1 goto :error

echo.
echo [2/4] Removendo node_modules...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=[IO.Path]::GetFullPath('%APP_DIR%');" ^
  "$targets=@((Join-Path $root 'node_modules'),(Join-Path $root 'client\node_modules'));" ^
  "foreach($target in $targets){" ^
  "$resolved=[IO.Path]::GetFullPath($target);" ^
  "if(-not $resolved.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Destino fora da pasta da aplicacao'};" ^
  "if(-not (Test-Path -LiteralPath $resolved)){Write-Host ('Nao encontrado: '+$resolved);continue};" ^
  "$removed=$false;" ^
  "for($attempt=1;$attempt -le 5;$attempt++){try{Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop;$removed=$true;break}catch{if($attempt -eq 5){throw};Write-Host ('Arquivo ainda ocupado. Nova tentativa '+($attempt+1)+'/5...');Start-Sleep -Seconds 2}};" ^
  "if(-not $removed -or (Test-Path -LiteralPath $resolved)){throw ('A pasta nao foi removida: '+$resolved)};" ^
  "Write-Host ('Removido: '+$resolved)" ^
  "}"
if errorlevel 1 goto :error

echo.
echo [3/4] Removendo pacote anterior, se existir...
if exist "%ZIP_PATH%" del /F /Q "%ZIP_PATH%"
if exist "%ZIP_PATH%" goto :error

echo.
echo [4/4] Criando %ZIP_NAME%...
where tar.exe >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O compactador tar.exe nao foi encontrado neste Windows.
  goto :error
)

tar.exe -a -c -f "%ZIP_PATH%" --exclude="%ZIP_NAME%" --exclude=".git" -C "%APP_DIR%" .
if errorlevel 1 goto :error
if not exist "%ZIP_PATH%" goto :error

echo.
echo ============================================
echo  Pacote criado com sucesso:
echo  %ZIP_PATH%
echo ============================================
echo.
echo No outro PC, extraia o ZIP e execute START.bat.
pause
exit /b 0

:error
echo.
echo [ERRO] Nao foi possivel concluir a operacao.
echo Feche terminais, editores ou antivirus que estejam usando a pasta e tente novamente.
pause
exit /b 1
