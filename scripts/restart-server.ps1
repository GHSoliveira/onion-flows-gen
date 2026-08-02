$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverEntry = Join-Path $projectRoot 'index.js'
$envFile = Join-Path $projectRoot '.env.sandbox'
$logDirectory = Join-Path $projectRoot 'sandbox\logs'
$stdoutLog = Join-Path $logDirectory 'backend.out.log'
$stderrLog = Join-Path $logDirectory 'backend.err.log'
$serverPort = 3101

if (-not (Test-Path -LiteralPath $serverEntry -PathType Leaf)) {
  throw "Servidor nao encontrado: $serverEntry"
}

Write-Host '[ONION] Encerrando backend atual...'
$listeners = Get-NetTCPConnection -LocalPort $serverPort -State Listen -ErrorAction SilentlyContinue
$processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($processId in $processIds) {
  if ($processId -le 0) { continue }
  Stop-Process -Id $processId -Force -ErrorAction Stop
  Write-Host "[ONION] Processo $processId encerrado."
}

if (Test-Path -LiteralPath $envFile -PathType Leaf) {
  Get-Content -LiteralPath $envFile | ForEach-Object {
    $line = ([string]$_).Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $separator = $line.IndexOf('=')
    if ($separator -le 0) { return }
    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$serverProcess = Start-Process `
  -FilePath $nodeCommand `
  -ArgumentList @($serverEntry) `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Write-Host "[ONION] Backend iniciado em segundo plano (PID $($serverProcess.Id))."

$healthUrl = "http://127.0.0.1:$serverPort/health"
for ($attempt = 1; $attempt -le 20; $attempt += 1) {
  if ($serverProcess.HasExited) {
    throw "O backend encerrou durante a inicializacao. Consulte $stderrLog"
  }
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Write-Host "[OK] Servidor reiniciado: $healthUrl"
      Write-Host '[ONION] Nenhuma aba do navegador foi aberta.'
      exit 0
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

throw "O servidor iniciou, mas nao respondeu em $healthUrl. Consulte $stderrLog"
