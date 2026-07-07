$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$outputPath = Join-Path $repoRoot "supabase\client-init.sql"
$migrationFiles = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name

if ($migrationFiles.Count -eq 0) {
  throw "No migration files found in $migrationsDirectory"
}

$headerLines = @(
  "-- Clothing Store - new customer Supabase initialization",
  "-- AUTHORITATIVE NEW CUSTOMER DEPLOYMENT SNAPSHOT.",
  "-- Run this file only in a brand-new, empty Supabase project.",
  "-- For customer deployment: paste the whole file into Supabase SQL Editor and click Run once.",
  "-- For development and upgrades: supabase/migrations remains the source of truth.",
  "-- Do not run this file on an existing customer database.",
  "-- Generated from the ordered migrations listed below.",
  ""
)

$parts = foreach ($migration in $migrationFiles) {
  @(
    "-- ============================================================================",
    "-- BEGIN MIGRATION: $($migration.Name)",
    "-- ============================================================================",
    [System.IO.File]::ReadAllText($migration.FullName),
    "-- END MIGRATION: $($migration.Name)",
    ""
  ) -join "`n"
}

$content = ($headerLines -join "`n") + "`n" + ($parts -join "`n")
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outputPath, $content, $utf8WithoutBom)

Write-Host "Generated $outputPath from $($migrationFiles.Count) migrations."
