param(
  [string]$BaseUrl = "http://localhost:3001",
  [string]$Token = "",
  [string]$Username = "",
  [string]$Password = "",
  [string]$TenantId = "",
  [switch]$SkipProtected
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param(
    [string]$Status,
    [string]$Label,
    [string]$Detail = ""
  )

  $color = switch ($Status) {
    "PASS" { "Green" }
    "FAIL" { "Red" }
    "WARN" { "Yellow" }
    default { "Cyan" }
  }

  $suffix = if ($Detail) { " - $Detail" } else { "" }
  Write-Host "[$Status] $Label$suffix" -ForegroundColor $color
}

function Invoke-FunctionalRequest {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    $Body = $null
  )

  $params = @{
    Method = $Method
    Uri = $Url
    Headers = $Headers
  }

  if ($null -ne $Body) {
    $params["Body"] = ($Body | ConvertTo-Json -Depth 8)
    $params["ContentType"] = "application/json"
  }

  try {
    $response = Invoke-RestMethod @params
    return @{
      Ok = $true
      Data = $response
      Error = $null
    }
  } catch {
    $message = $_.Exception.Message
    $bodyText = $null
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $bodyText = $reader.ReadToEnd()
      }
    } catch {
    }
    return @{
      Ok = $false
      Data = $null
      Error = if ($bodyText) { "$message | $bodyText" } else { $message }
    }
  }
}

function Add-Result {
  param(
    [ref]$Results,
    [string]$Name,
    [bool]$Ok,
    [string]$Detail
  )

  $Results.Value += [pscustomobject]@{
    Name = $Name
    Ok = $Ok
    Detail = $Detail
  }

  Write-Step -Status ($(if ($Ok) { "PASS" } else { "FAIL" })) -Label $Name -Detail $Detail
}

$normalizedBaseUrl = $BaseUrl.TrimEnd('/')
$results = @()
$resolvedToken = $Token
$resolvedTenantId = $TenantId

Write-Host ""
Write-Host "== Functional Validation ==" -ForegroundColor Cyan
Write-Host "Base URL: $normalizedBaseUrl" -ForegroundColor DarkCyan
Write-Host ""

$health = Invoke-FunctionalRequest -Method "GET" -Url "$normalizedBaseUrl/health"
Add-Result -Results ([ref]$results) -Name "Health endpoint" -Ok $health.Ok -Detail ($(if ($health.Ok) { "status=$($health.Data.status)" } else { $health.Error }))

if (-not $resolvedToken -and $Username -and $Password) {
  $login = Invoke-FunctionalRequest -Method "POST" -Url "$normalizedBaseUrl/api/auth/login" -Body @{
    username = $Username
    password = $Password
  }
  if ($login.Ok -and $login.Data.token) {
    $resolvedToken = [string]$login.Data.token
    Add-Result -Results ([ref]$results) -Name "Login" -Ok $true -Detail "token obtido para $Username"
  } else {
    Add-Result -Results ([ref]$results) -Name "Login" -Ok $false -Detail $login.Error
  }
}

if ($SkipProtected) {
  Write-Step -Status "WARN" -Label "Protected endpoints" -Detail "ignorados por parametro"
} elseif (-not $resolvedToken) {
  Add-Result -Results ([ref]$results) -Name "Protected endpoints" -Ok $false -Detail "informe -Token ou -Username/-Password"
} else {
  $headers = @{
    Authorization = "Bearer $resolvedToken"
  }

  $heartbeatUrl = "$normalizedBaseUrl/api/auth/heartbeat"
  if ($resolvedTenantId) {
    $heartbeatUrl = "$heartbeatUrl?tenantId=$resolvedTenantId"
  }

  $heartbeat = Invoke-FunctionalRequest -Method "GET" -Url $heartbeatUrl -Headers $headers
  if ($heartbeat.Ok) {
    $role = [string]$heartbeat.Data.user.role
    if (-not $resolvedTenantId) {
      $resolvedTenantId = [string]$heartbeat.Data.user.tenantId
    }
    Add-Result -Results ([ref]$results) -Name "Auth heartbeat" -Ok $true -Detail "role=$role tenant=$resolvedTenantId"

    $tenantCurrent = Invoke-FunctionalRequest -Method "GET" -Url "$normalizedBaseUrl/api/tenant/current" -Headers $headers
    Add-Result -Results ([ref]$results) -Name "Current tenant" -Ok $tenantCurrent.Ok -Detail ($(if ($tenantCurrent.Ok) { "$($tenantCurrent.Data.id) / $($tenantCurrent.Data.name)" } else { $tenantCurrent.Error }))

    $chats = Invoke-FunctionalRequest -Method "GET" -Url "$normalizedBaseUrl/api/chats" -Headers $headers
    Add-Result -Results ([ref]$results) -Name "Chats list" -Ok $chats.Ok -Detail ($(if ($chats.Ok) { "ok" } else { $chats.Error }))

    $myQueues = Invoke-FunctionalRequest -Method "GET" -Url "$normalizedBaseUrl/api/chats/my-queues" -Headers $headers
    Add-Result -Results ([ref]$results) -Name "My queues" -Ok $myQueues.Ok -Detail ($(if ($myQueues.Ok) { "ok" } else { $myQueues.Error }))

    $contacts = Invoke-FunctionalRequest -Method "GET" -Url "$normalizedBaseUrl/api/contacts?limit=5" -Headers $headers
    Add-Result -Results ([ref]$results) -Name "Contacts" -Ok $contacts.Ok -Detail ($(if ($contacts.Ok) { "ok" } else { $contacts.Error }))

    if ($role -in @("ADMIN", "MANAGER", "SUPER_ADMIN")) {
      $adminChecks = @(
        @{ Name = "Flows"; Url = "$normalizedBaseUrl/api/flows" },
        @{ Name = "Templates"; Url = "$normalizedBaseUrl/api/templates" },
        @{ Name = "Channels"; Url = "$normalizedBaseUrl/api/channels" },
        @{ Name = "Queues"; Url = "$normalizedBaseUrl/api/queues" },
        @{ Name = "Schedules"; Url = "$normalizedBaseUrl/api/schedules" }
      )

      foreach ($check in $adminChecks) {
        $response = Invoke-FunctionalRequest -Method "GET" -Url $check.Url -Headers $headers
        Add-Result -Results ([ref]$results) -Name $check.Name -Ok $response.Ok -Detail ($(if ($response.Ok) { "ok" } else { $response.Error }))
      }
    }

    if ($role -eq "SUPER_ADMIN") {
      $tenants = Invoke-FunctionalRequest -Method "GET" -Url "$normalizedBaseUrl/api/tenants" -Headers $headers
      Add-Result -Results ([ref]$results) -Name "Tenants" -Ok $tenants.Ok -Detail ($(if ($tenants.Ok) { "ok" } else { $tenants.Error }))
    }
  } else {
    Add-Result -Results ([ref]$results) -Name "Auth heartbeat" -Ok $false -Detail $heartbeat.Error
  }
}

$failed = @($results | Where-Object { -not $_.Ok })
Write-Host ""
Write-Host "== Summary ==" -ForegroundColor Cyan
Write-Host ("Pass: {0}" -f (@($results | Where-Object { $_.Ok }).Count))
Write-Host ("Fail: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  exit 1
}

exit 0
