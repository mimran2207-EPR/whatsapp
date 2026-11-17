<#
.SYNOPSIS
  Runs M1 locally: migrates and seeds the `whatsapp` database, then starts the API (5080), the Worker and `npm start` (4200).

.DESCRIPTION
  Touches ONLY the database `whatsapp` on the SQL Server instance ($SqlServer, Windows auth).
  Everything is Sandbox (mock provider) with synthetic data. No secret is stored in the repo: the signing keys come from
  dotnet user-secrets, which this script checks (it never creates or prints them).
  Ctrl+C stops the frontend; the API and the Worker are stopped with it.

.PARAMETER SqlServer
  SQL Server host. Default: localhost.
#>
[CmdletBinding()]
param([string]$SqlServer = 'localhost')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root 'src/backend/ResidentComms.Api'
$worker = Join-Path $root 'src/backend/ResidentComms.Worker'
$migrator = Join-Path $root 'src/backend/tools/ResidentComms.DbMigrator'
$web = Join-Path $root 'src/frontend'

function Test-Secret([string]$project, [string]$key) {
    $lines = & dotnet user-secrets list --project $project 2>$null
    return [bool]($lines | Where-Object { $_ -match ('^' + [regex]::Escape($key) + '\s*=\s*\S') })
}

$missing = @()
if (-not (Test-Secret $api 'Auth:DevSigningKey')) {
    $missing += 'dotnet user-secrets set "Auth:DevSigningKey" "<random string, 32+ bytes>" --project src/backend/ResidentComms.Api'
}
if (-not (Test-Secret $api 'Providers:MockSms:SigningKey')) {
    $missing += 'dotnet user-secrets set "Providers:MockSms:SigningKey" "<random string, 32+ bytes>" --project src/backend/ResidentComms.Api'
}
if (-not (Test-Secret $worker 'Providers:MockSms:SigningKey')) {
    $missing += 'dotnet user-secrets set "Providers:MockSms:SigningKey" "<the same value as in the Api project>" --project src/backend/ResidentComms.Worker'
}
if ($missing.Count -gt 0) {
    Write-Host 'Missing user-secrets. Run these once (replace the placeholders with your own random values; never commit them):' -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  $_" }
    Write-Host 'The Providers:MockSms:SigningKey value must be identical in the Api and Worker projects.'
    exit 1
}

Write-Host '== Migrating and seeding database "whatsapp" (Sandbox, synthetic data) ==' -ForegroundColor Cyan
& dotnet run --project $migrator -- --server $SqlServer --database whatsapp --seed-dev
if ($LASTEXITCODE -ne 0) { throw 'DbMigrator failed.' }

$connection = "Server=$SqlServer;Database=whatsapp;Integrated Security=true;TrustServerCertificate=true"
$started = @()
try {
    Write-Host '== Starting API on http://localhost:5080 ==' -ForegroundColor Cyan
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:ConnectionStrings__Default = $connection
    $started += Start-Process dotnet -ArgumentList @('run', '--no-launch-profile', '--project', "`"$api`"", '--urls', 'http://localhost:5080') -PassThru -NoNewWindow

    Write-Host '== Starting Worker (mock SMS provider) ==' -ForegroundColor Cyan
    $env:DOTNET_ENVIRONMENT = 'Development'
    $started += Start-Process dotnet -ArgumentList @('run', '--project', "`"$worker`"") -PassThru -NoNewWindow

    Write-Host '== Starting frontend: http://localhost:4200 (Ctrl+C to stop everything) ==' -ForegroundColor Cyan
    Push-Location $web
    try {
        if (-not (Test-Path 'node_modules')) { & npm ci }
        & npm start
    } finally { Pop-Location }
} finally {
    foreach ($p in $started) {
        if ($p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F | Out-Null }
    }
}
