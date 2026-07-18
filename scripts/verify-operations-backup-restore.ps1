$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceConfig = Join-Path $repoRoot "supabase\config.toml"
$token = "AUDIT_BACKUP_6B"
$targetProjectRef = "local-restore"
$targetRoot = Join-Path $env:TEMP ("clothing-6b-restore-target-" + [guid]::NewGuid().ToString("N"))
$backupRoot = Join-Path $env:TEMP ("clothing-6b-backup-" + [guid]::NewGuid().ToString("N"))
$targetStarted = $false
$startedAt = Get-Date

function Assert-TemporaryPath([string]$Path) {
  $temporary = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (!$resolved.StartsWith($temporary, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to manage a path outside the operating-system temporary directory"
  }
}

function Read-LocalEnvironment([string]$Workdir = "") {
  if ($Workdir) { $lines = npx supabase status --workdir $Workdir -o env }
  else { $lines = npx supabase status -o env }
  if ($LASTEXITCODE -ne 0) { throw "Unable to read isolated Supabase status" }
  $values = @{}
  foreach ($line in $lines) {
    if ($line -match '^([A-Z0-9_]+)="(.*)"$') { $values[$matches[1]] = $matches[2] }
  }
  foreach ($name in @("API_URL", "DB_URL", "SERVICE_ROLE_KEY")) {
    if (!$values[$name]) { throw "Supabase status did not provide $name" }
  }
  return $values
}

function Invoke-NodeFixture([hashtable]$Environment, [string]$Mode) {
  $previousUrl = $env:NEXT_PUBLIC_SUPABASE_URL
  $previousKey = $env:SUPABASE_SERVICE_ROLE_KEY
  try {
    $env:NEXT_PUBLIC_SUPABASE_URL = $Environment["API_URL"]
    Set-Item -Path ("Env:" + "SUPABASE_SERVICE_ROLE_KEY") -Value $Environment["SERVICE_ROLE_KEY"]
    $env:BACKUP_DRILL_MODE = $Mode
    $script = @'
import { createClient } from "@supabase/supabase-js";
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const mode = process.env.BACKUP_DRILL_MODE;
if (mode === "create") {
  await client.storage.from("product-images").remove(["audit/backup-6b.webp"]);
  await client.from("products").delete().eq("sku", "AUDIT_BACKUP_6B");
  const inserted = await client.from("products").insert({
    sku: "AUDIT_BACKUP_6B", name_cn: "Backup fixture", name_en: "Backup fixture", name_gr: "Backup fixture",
    category: "audit", subcategory: "backup", price: 7, stock: 0, sizes: "ONE SIZE", size_stock: { "ONE SIZE": 0 }, is_active: true,
  });
  if (inserted.error) throw inserted.error;
  const uploaded = await client.storage.from("product-images").upload("audit/backup-6b.webp", Buffer.from([82,73,70,70,4,0,0,0,87,69,66,80]), { contentType: "image/webp", upsert: true });
  if (uploaded.error) throw uploaded.error;
} else if (mode === "verify") {
  const product = await client.from("products").select("id").eq("sku", "AUDIT_BACKUP_6B").single();
  if (product.error) throw product.error;
  const object = await client.storage.from("product-images").download("audit/backup-6b.webp");
  if (object.error || !object.data) throw object.error || new Error("restored object missing");
  const bytes = Buffer.from(await object.data.arrayBuffer());
  if (bytes.toString("hex") !== "524946460400000057454250") throw new Error("restored object content mismatch");
} else if (mode === "cleanup") {
  await client.storage.from("product-images").remove(["audit/backup-6b.webp"]);
  await client.from("products").delete().eq("sku", "AUDIT_BACKUP_6B");
} else {
  throw new Error("unknown backup drill mode");
}
'@
    $script | node --input-type=module -
    if ($LASTEXITCODE -ne 0) { throw "Backup drill fixture $Mode failed" }
  }
  finally {
    $env:NEXT_PUBLIC_SUPABASE_URL = $previousUrl
    if ($null -eq $previousKey) { Remove-Item ("Env:" + "SUPABASE_SERVICE_ROLE_KEY") -ErrorAction SilentlyContinue }
    else { Set-Item -Path ("Env:" + "SUPABASE_SERVICE_ROLE_KEY") -Value $previousKey }
    Remove-Item Env:BACKUP_DRILL_MODE -ErrorAction SilentlyContinue
  }
}

Assert-TemporaryPath $targetRoot
Assert-TemporaryPath $backupRoot

try {
  $source = Read-LocalEnvironment
  if ($source["API_URL"] -ne "http://127.0.0.1:55321") { throw "Source must be clothing_web local Supabase" }
  Invoke-NodeFixture $source "create"

  $env:NEXT_PUBLIC_SUPABASE_URL = $source["API_URL"]
  Set-Item -Path ("Env:" + "SUPABASE_SERVICE_ROLE_KEY") -Value $source["SERVICE_ROLE_KEY"]
  npm run customer:backup -- --project-ref local-source --output $backupRoot --yes --test-local
  if ($LASTEXITCODE -ne 0) { throw "Customer backup command failed" }
  npm run customer:backup:verify -- --backup $backupRoot
  if ($LASTEXITCODE -ne 0) { throw "Customer backup verification failed" }

  New-Item -ItemType Directory -Path (Join-Path $targetRoot "supabase") -Force | Out-Null
  $config = [System.IO.File]::ReadAllText($sourceConfig, [System.Text.Encoding]::UTF8)
  $config = $config.Replace('project_id = "clothing_web"', 'project_id = "clothing_6b_restore_target"').Replace('5532', '5632')
  [System.IO.File]::WriteAllText((Join-Path $targetRoot "supabase\config.toml"), $config, (New-Object System.Text.UTF8Encoding($false)))

  npx supabase start --workdir $targetRoot | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to start isolated restore Supabase" }
  $targetStarted = $true
  $target = Read-LocalEnvironment $targetRoot
  if ($target["API_URL"] -ne "http://127.0.0.1:56321") { throw "Restore target API identity mismatch" }
  if ($target["DB_URL"] -notmatch '127\.0\.0\.1:56322/postgres$') { throw "Restore target DB identity mismatch" }

  $env:NEXT_PUBLIC_SUPABASE_URL = $target["API_URL"]
  Set-Item -Path ("Env:" + "SUPABASE_SERVICE_ROLE_KEY") -Value $target["SERVICE_ROLE_KEY"]
  $env:SUPABASE_DB_URL = $target["DB_URL"] + "?sslmode=disable"
  npm run customer:restore -- --project-ref $targetProjectRef --backup $backupRoot --yes --test-local
  if ($LASTEXITCODE -ne 0) { throw "Customer restore command failed" }
  Invoke-NodeFixture $target "verify"

  $elapsed = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  Write-Host "PASS database and Storage backup manifest verification"
  Write-Host "PASS isolated database restore with application fixture"
  Write-Host "PASS isolated Storage object restore with byte-for-byte verification"
  Write-Host "PASS restore drill completed in $elapsed seconds (RTO target is 4 hours)"
}
finally {
  try {
    $source = Read-LocalEnvironment
    Invoke-NodeFixture $source "cleanup"
  } catch { Write-Warning "Source fixture cleanup requires review: $($_.Exception.Message)" }
  if ($targetStarted) { npx supabase stop --workdir $targetRoot --no-backup | Out-Null }
  foreach ($temporaryPath in @($targetRoot, $backupRoot)) {
    Assert-TemporaryPath $temporaryPath
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Recurse -Force }
  }
  Remove-Item Env:SUPABASE_DB_URL -ErrorAction SilentlyContinue
}
