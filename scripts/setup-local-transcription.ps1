param(
  [switch]$InstallMissingRuntime
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$requirements = Join-Path $projectRoot 'requirements-transcription.txt'
$runtimeRoot = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'Onion\runtime'
} else {
  Join-Path $projectRoot '.onion-runtime'
}
$venvRoot = Join-Path $runtimeRoot 'transcription-venv'
$venvPython = if ($IsLinux -or $IsMacOS) {
  Join-Path $venvRoot 'bin/python'
} else {
  Join-Path $venvRoot 'Scripts\python.exe'
}

function Find-PythonLauncher {
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    return @{ Command = $py.Source; Prefix = @('-3') }
  }
  $knownLauncher = Join-Path $env:LOCALAPPDATA 'Programs\Python\Launcher\py.exe'
  if (Test-Path -LiteralPath $knownLauncher -PathType Leaf) {
    return @{ Command = $knownLauncher; Prefix = @('-3') }
  }
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($python -and $python.Source -notmatch 'WindowsApps') {
    return @{ Command = $python.Source; Prefix = @() }
  }
  return $null
}

function Install-PythonRuntime {
  if (-not $InstallMissingRuntime) {
    throw 'Python 3.11+ nao encontrado. Execute START.bat para instalar o requisito local.'
  }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Python nao encontrado e winget indisponivel. Instale Python 3.12 e execute START.bat novamente.'
  }
  Write-Host '[TRANSCRICAO] Instalando Python 3.12 pelo winget...'
  & $winget.Source install --id Python.Python.3.12 --exact --source winget --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    throw "winget nao conseguiu instalar Python 3.12 (codigo $LASTEXITCODE)."
  }
}

if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) {
  throw "Requisitos de transcricao nao encontrados: $requirements"
}

$launcher = Find-PythonLauncher
if (-not $launcher) {
  Install-PythonRuntime
  $launcher = Find-PythonLauncher
}
if (-not $launcher) {
  throw 'Python foi instalado, mas ainda nao esta disponivel. Feche esta janela e execute START.bat novamente.'
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
  Write-Host '[TRANSCRICAO] Criando ambiente Python local isolado...'
  & $launcher.Command @($launcher.Prefix) -m venv $venvRoot
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    throw 'Falha ao criar o ambiente Python local de transcricao.'
  }
}

$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $venvPython -c "import ctranslate2, faster_whisper, setuptools; assert ctranslate2.__version__ == '4.6.0'; assert faster_whisper.__version__ == '1.2.1'; assert setuptools.__version__ == '80.9.0'" 2>$null
$dependencyCheckExit = $LASTEXITCODE
$ErrorActionPreference = $previousErrorPreference
if ($dependencyCheckExit -ne 0) {
  Write-Host '[TRANSCRICAO] Instalando motor local em versoes validadas para Windows...'
  & $venvPython -m pip install --disable-pip-version-check --no-warn-script-location -r $requirements
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao instalar o faster-whisper. Confira a internet e tente novamente.'
  }
}

Write-Host '[OK] Transcricao local pronta. O modelo sera baixado somente no primeiro uso.'
