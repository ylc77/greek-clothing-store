$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  $status = & npx supabase status -o env 2>$null
  $statusCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousPreference
}
if ($statusCode -ne 0) { throw "Local Supabase is not running." }

function Get-LocalSupabaseValue([string]$Name) {
  $line = $status | Where-Object { $_ -like "$Name=*" } | Select-Object -First 1
  if (-not $line) { throw "Local Supabase did not return $Name." }
  return ($line.Substring($Name.Length + 1)).Trim('"')
}

$env:NEXT_PUBLIC_SUPABASE_URL = Get-LocalSupabaseValue "API_URL"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = Get-LocalSupabaseValue "ANON_KEY"
$env:SUPABASE_SERVICE_ROLE_KEY = Get-LocalSupabaseValue "SERVICE_ROLE_KEY"
$env:NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3010"
$env:BASE_URL = $env:NEXT_PUBLIC_SITE_URL
$env:USE_POS_RPC = "true"
$env:USE_PRODUCT_RPC = "true"
$env:USE_CSV_IMPORT_RPC = "true"
$env:AUTH_RATE_LIMIT_SECRET = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$env:ADMIN_PASSWORD = "LocalOwner!A1" + [guid]::NewGuid().ToString("N")
$env:ADMIN_STAFF_PASSWORD = "LocalStaff!A1" + [guid]::NewGuid().ToString("N")
$env:ADMIN_INVENTORY_PASSWORD = "LocalInventory!A1" + [guid]::NewGuid().ToString("N")
$env:ADMIN_READONLY_PASSWORD = "LocalReadonly!A1" + [guid]::NewGuid().ToString("N")

$occupied = Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue
if ($occupied) { throw "Port 3010 is already in use." }

Push-Location $repoRoot
$server = $null
$logId = [guid]::NewGuid().ToString("N")
$stdoutLog = Join-Path ([System.IO.Path]::GetTempPath()) "clothing-channels-$logId.out.log"
$stderrLog = Join-Path ([System.IO.Path]::GetTempPath()) "clothing-channels-$logId.err.log"
try {
  if ($env:CHANNELS_SKIP_BUILD -ne "true") {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed." }
  }

  $node = (Get-Command node).Source
  $server = Start-Process -FilePath $node `
    -ArgumentList @(".\node_modules\next\dist\bin\next", "start", "-p", "3010") `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  $deadline = (Get-Date).AddSeconds(35)
  $ready = $false
  do {
    Start-Sleep -Milliseconds 800
    if ($server.HasExited) {
      $details = ((Get-Content -LiteralPath $stderrLog -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $stdoutLog -ErrorAction SilentlyContinue)) -join " "
      throw "Local production server exited before verification: $details"
    }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$($env:BASE_URL)/" -TimeoutSec 3
      $ready = $response.StatusCode -eq 200
    } catch {
      $ready = $false
    }
  } while (-not $ready -and (Get-Date) -lt $deadline)
  if (-not $ready) {
    $details = ((Get-Content -LiteralPath $stderrLog -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $stdoutLog -ErrorAction SilentlyContinue)) -join " "
    throw "Local production server did not become ready: $details"
  }

  & npm.cmd run test:channels-browser
  if ($LASTEXITCODE -ne 0) { throw "Channel browser checks failed." }
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
  Pop-Location
}
