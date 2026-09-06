$ErrorActionPreference = "Stop"

$port = 3015
$baseUrl = "http://127.0.0.1:$port"
$stdoutPath = Join-Path $env:TEMP "clothing-online-runtime.out.log"
$stderrPath = Join-Path $env:TEMP "clothing-online-runtime.err.log"
$startedProcess = $null

function New-RandomHex([int] $byteCount) {
  $bytes = New-Object byte[] $byteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return ([BitConverter]::ToString($bytes) -replace '-', '')
}

function Stop-LocalRuntime {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  if ($startedProcess -and -not $startedProcess.HasExited) {
    Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue
  }
  for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $stdoutPath) -and -not (Test-Path -LiteralPath $stderrPath)) {
      break
    }
    Start-Sleep -Milliseconds 250
  }
}

try {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Stop the existing process before running this smoke test."
  }

  $statusText = (& cmd.exe /d /s /c "npx supabase status -o env 2>nul" | Out-String)
  $statusExitCode = $LASTEXITCODE
  if ($statusExitCode -ne 0) {
    throw "Local Supabase is not available."
  }

  $localEnvironment = @{}
  foreach ($line in ($statusText -split "`r?`n")) {
    if ($line -match '^([A-Z0-9_]+)="?(.*?)"?$') {
      $localEnvironment[$matches[1]] = $matches[2].TrimEnd('"')
    }
  }

  foreach ($name in @("API_URL", "ANON_KEY", "SERVICE_ROLE_KEY")) {
    if (-not $localEnvironment[$name]) {
      throw "Local Supabase did not provide $name."
    }
  }

  $adminPassword = "LocalAdmin9" + (New-RandomHex 16)
  $env:NEXT_PUBLIC_SUPABASE_URL = $localEnvironment.API_URL
  $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $localEnvironment.ANON_KEY
  Set-Item -Path Env:SUPABASE_SERVICE_ROLE_KEY -Value $localEnvironment.SERVICE_ROLE_KEY
  $env:ADMIN_PASSWORD = $adminPassword
  $env:AUTH_RATE_LIMIT_SECRET = New-RandomHex 32
  $env:USE_ONLINE_ORDER_RPC = "true"
  $env:NEXT_PUBLIC_SITE_URL = $baseUrl

  Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  $startedProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev", "--", "-p", "$port") `
    -WorkingDirectory (Split-Path $PSScriptRoot -Parent) `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath

  $deadline = (Get-Date).AddSeconds(60)
  do {
    try {
      $null = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 3
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)

  if ((Get-Date) -ge $deadline) {
    throw "Local Next.js server did not become ready."
  }

  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  try {
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    $client.DefaultRequestHeaders.Add("x-admin-password", $adminPassword)
    $response = $client.GetAsync("$baseUrl/api/admin/online-orders/health").GetAwaiter().GetResult()
    try {
      $statusCode = [int] $response.StatusCode
      $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    } finally {
      $response.Dispose()
    }
  } finally {
    $client.Dispose()
  }

  [pscustomobject]@{
    HttpStatus = $statusCode
    Ready = $body.ready
    DatabaseReady = $body.database.ready
    IssueCount = @($body.issues).Count
    Issues = @($body.issues)
  } | ConvertTo-Json -Depth 4
} finally {
  Stop-LocalRuntime
}
