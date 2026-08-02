$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$EnvFile = Join-Path $Root '.env.sandbox'
$TemplateFile = Join-Path $Root '.env.sandbox.example'

function Read-EnvMap {
  param([string]$Path)
  $values = @{}
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith('#')) { return }
    $separatorIndex = $line.IndexOf('=')
    if ($separatorIndex -lt 1) { return }
    $name = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()
    $values[$name] = $value
  }
  return $values
}

function Assert-SandboxEnv {
  param([string]$Path)
  $values = Read-EnvMap -Path $Path
  foreach ($required in @('JWT_SECRET', 'PORT', 'DB_ADAPTER', 'JSON_DB_PATH')) {
    if (!$values.ContainsKey($required) -or [string]::IsNullOrWhiteSpace($values[$required])) {
      throw ".env.sandbox invalido: $required ausente ou vazio."
    }
  }
  if ($values.JWT_SECRET -eq '__GENERATED_JWT_SECRET__' -or $values.JWT_SECRET.Length -lt 32) {
    throw '.env.sandbox invalido: JWT_SECRET precisa ter pelo menos 32 caracteres.'
  }
  if ($values.PORT -ne '3101') {
    throw ".env.sandbox invalido: PORT deve ser 3101 no pacote local (recebido: $($values.PORT))."
  }
  if ($values.DB_ADAPTER.ToLowerInvariant() -ne 'json' -and $values.USE_JSON_DB -ne 'true') {
    throw '.env.sandbox invalido: use DB_ADAPTER=json para o pacote local.'
  }
}

if (!(Test-Path -LiteralPath $EnvFile)) {
  if (!(Test-Path -LiteralPath $TemplateFile)) {
    throw "Template .env.sandbox.example nao encontrado em $TemplateFile"
  }

  $secretBytes = New-Object byte[] 48
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($secretBytes)
  } finally {
    $generator.Dispose()
  }
  $jwtSecret = [Convert]::ToBase64String($secretBytes)
  $contents = [IO.File]::ReadAllText($TemplateFile).Replace('__GENERATED_JWT_SECRET__', $jwtSecret)
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($EnvFile, $contents, $utf8WithoutBom)

  Write-Host '[SANDBOX] .env.sandbox criado automaticamente com segredo local aleatorio.'
  Write-Host '[SANDBOX] Chaves de IA permanecem vazias e podem ser configuradas depois.'
} else {
  Write-Host '[SANDBOX] Configuracao local encontrada: .env.sandbox'
}

Assert-SandboxEnv -Path $EnvFile
Write-Host '[SANDBOX] Configuracao local validada.'