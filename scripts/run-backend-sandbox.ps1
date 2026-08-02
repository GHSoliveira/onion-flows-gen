$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
. (Join-Path $PSScriptRoot 'load-sandbox-env.ps1')

Set-Location -LiteralPath $Root

& node scripts/seed-sandbox-json.js
if ($LASTEXITCODE -ne 0) {
  throw "Seed sandbox falhou com codigo $LASTEXITCODE"
}

& npm.cmd start
exit $LASTEXITCODE
