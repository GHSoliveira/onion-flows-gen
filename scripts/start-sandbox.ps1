$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$SandboxDir = Join-Path $Root 'sandbox'
$LogsDir = Join-Path $SandboxDir 'logs'
$BackendOut = Join-Path $LogsDir 'backend.out.log'
$BackendErr = Join-Path $LogsDir 'backend.err.log'
$FrontendOut = Join-Path $LogsDir 'frontend.out.log'
$FrontendErr = Join-Path $LogsDir 'frontend.err.log'

function Show-LogTail {
  param([string]$Label, [string]$Path)
  if (!(Test-Path -LiteralPath $Path)) { return }
  $lines = @(Get-Content -LiteralPath $Path -Tail 35 -ErrorAction SilentlyContinue)
  if ($lines.Count -eq 0) { return }
  Write-Host "--- $Label ---" -ForegroundColor Yellow
  $lines | ForEach-Object { Write-Host $_ }
}

function Wait-SandboxEndpoint {
  param(
    [string]$Name,
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [string]$ExpectedText,
    [int]$Attempts = 40
  )

  $lastError = 'sem resposta'
  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    $Process.Refresh()
    if ($Process.HasExited) {
      throw "$Name encerrou durante a inicializacao (codigo $($Process.ExitCode))."
    }
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and (!$ExpectedText -or $response.Content -match $ExpectedText)) {
        Write-Host "[SANDBOX] $Name confirmado: $Url" -ForegroundColor Green
        return
      }
      $lastError = "HTTP $($response.StatusCode) com resposta inesperada"
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 500
  }
  throw "$Name nao respondeu em $Url. Ultimo erro: $lastError"
}

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $SandboxDir 'data') | Out-Null

& (Join-Path $PSScriptRoot 'stop-sandbox.ps1') -Quiet

foreach ($logPath in @($BackendOut, $BackendErr, $FrontendOut, $FrontendErr)) {
  Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
}

$backendScript = Join-Path $PSScriptRoot 'run-backend-sandbox.ps1'
$frontendScript = Join-Path $PSScriptRoot 'run-frontend-sandbox.ps1'
$backend = $null

try {
  Write-Host '[SANDBOX] Compilando frontend local...'
  $frontendBuild = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$frontendScript`"" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -Wait `
    -PassThru `
    -RedirectStandardOutput $FrontendOut `
    -RedirectStandardError $FrontendErr
  if ($frontendBuild.ExitCode -ne 0) {
    throw "Build do frontend falhou (codigo $($frontendBuild.ExitCode))."
  }

  Write-Host '[SANDBOX] Iniciando backend...'
  $backend = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$backendScript`"" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $BackendOut `
    -RedirectStandardError $BackendErr
  Set-Content -LiteralPath (Join-Path $SandboxDir 'backend.pid') -Value $backend.Id

  Wait-SandboxEndpoint `
    -Name 'Backend' `
    -Url 'http://127.0.0.1:3101/health' `
    -Process $backend `
    -ExpectedText '"status"\s*:\s*"ok"'

  Wait-SandboxEndpoint `
    -Name 'Frontend' `
    -Url 'http://127.0.0.1:3101' `
    -Process $backend `
    -ExpectedText '<div id="root"'

  Write-Host '[SANDBOX] Backend:  http://127.0.0.1:3101'
  Write-Host '[SANDBOX] Health:   http://127.0.0.1:3101/health'
  Write-Host '[SANDBOX] Frontend: http://127.0.0.1:3101'
  Write-Host '[SANDBOX] Login super-admin: admin / sandbox123'
  Write-Host '[SANDBOX] Login agent:       agent / sandbox123'
  Write-Host "[SANDBOX] Logs: $LogsDir"
  exit 0
} catch {
  Write-Host ''
  Write-Host "[ERRO] $($_.Exception.Message)" -ForegroundColor Red
  Show-LogTail -Label 'backend.err.log' -Path $BackendErr
  Show-LogTail -Label 'backend.out.log' -Path $BackendOut
  Show-LogTail -Label 'frontend.err.log' -Path $FrontendErr
  Show-LogTail -Label 'frontend.out.log' -Path $FrontendOut
  & (Join-Path $PSScriptRoot 'stop-sandbox.ps1') -Quiet
  exit 1
}
