param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = 'Stop'

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$extensionPath = Join-Path $rootPath 'genesys-onion-dev'
if (!(Test-Path -LiteralPath (Join-Path $extensionPath 'manifest.json'))) {
  throw "Extensao Onion Companion nao encontrada em $extensionPath"
}

try {
  Set-Clipboard -Value $extensionPath
} catch {
  $extensionPath | clip.exe
}

$browserDefinitions = @(
  @{
    Process = 'brave'
    ExtensionsUrl = 'brave://extensions/'
    Paths = @(
      (Join-Path $env:ProgramFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'BraveSoftware\Brave-Browser\Application\brave.exe'),
      (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe')
    )
  },
  @{
    Process = 'chrome'
    ExtensionsUrl = 'chrome://extensions/'
    Paths = @(
      (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
  },
  @{
    Process = 'msedge'
    ExtensionsUrl = 'edge://extensions/'
    Paths = @(
      (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
  }
)

$selected = $null
$browserExecutable = $null

foreach ($definition in $browserDefinitions) {
  $running = Get-Process -Name $definition.Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and (Test-Path -LiteralPath $_.Path) } |
    Select-Object -First 1
  if ($running) {
    $selected = $definition
    $browserExecutable = $running.Path
    break
  }
}

if (!$browserExecutable) {
  foreach ($definition in $browserDefinitions) {
    $installed = $definition.Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($installed) {
      $selected = $definition
      $browserExecutable = $installed
      break
    }
  }
}

Start-Process -FilePath 'explorer.exe' -ArgumentList @($extensionPath)

if (!$browserExecutable) {
  Start-Process 'http://127.0.0.1:3101'
  Write-Host '[EXTENSAO] Brave, Chrome ou Edge nao foram localizados.' -ForegroundColor Yellow
  Write-Host "[EXTENSAO] Caminho copiado: $extensionPath"
  exit 1
}

Start-Process -FilePath $browserExecutable -ArgumentList @($selected.ExtensionsUrl)
Start-Sleep -Milliseconds 350
Start-Process -FilePath $browserExecutable -ArgumentList @('http://127.0.0.1:3101')

Write-Host "[EXTENSAO] Navegador preparado: $($selected.Process)" -ForegroundColor Green
Write-Host "[EXTENSAO] Caminho copiado: $extensionPath"
Write-Host '[EXTENSAO] Ative o modo do desenvolvedor e clique em Carregar sem compactacao.'
exit 0
