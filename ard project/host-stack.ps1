# Hosts the Phoenix Door test stack on this PC: Postgres (5433) + backend API (4000).
# Run it in your own PowerShell so it keeps running independently:
#     cd "C:\Users\Ragna\Downloads\PHXSECINTERNALTEST\ard project"
#     .\host-stack.ps1
# Stop it later with .\stop-stack.ps1

$PG      = "C:\Program Files\PostgreSQL\18\bin"
$DATA    = "C:\Users\Ragna\phx-door-pgdata"
$BACKEND = "C:\Users\Ragna\Downloads\PHXSECINTERNALTEST\ard project\backend"

# 1. Postgres — start only if it isn't already accepting connections.
& "$PG\pg_isready.exe" -h 127.0.0.1 -p 5433 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting Postgres on 5433..."
    if (Test-Path "$DATA\postmaster.pid") { Remove-Item "$DATA\postmaster.pid" -Force -ErrorAction SilentlyContinue }
    # IMPORTANT: log OUTSIDE the data dir. A log file inside $DATA collides with
    # crash-recovery's fsync of the data dir ("sharing violation") and wedges startup.
    $log = "C:\Users\Ragna\phx-door.log"
    & "$PG\pg_ctl.exe" -D $DATA -o "-p 5433" -l $log -w start
} else {
    Write-Host "Postgres already running on 5433."
}

# 2. Backend API — launch in its OWN window so it survives this script's window closing.
$apiUp = $false
try { Invoke-RestMethod "http://localhost:4000/health" -TimeoutSec 2 | Out-Null; $apiUp = $true } catch {}
if (-not $apiUp) {
    Write-Host "Starting backend API on 4000 (new window)..."
    Start-Process powershell -ArgumentList "-NoExit","-Command","Set-Location '$BACKEND'; node src/index.js"
} else {
    Write-Host "Backend already running on 4000."
}

Start-Sleep -Seconds 2
Write-Host ""
Write-Host "===== Phoenix Door hosted =====" -ForegroundColor Green
Write-Host "  API (phone / LAN):  http://192.168.10.224:4000"
Write-Host "  API (this PC):       http://localhost:4000"
Write-Host "  Admin login:   admin@phoenixsectech.com / Admin1234!"
Write-Host "  Mobile login:  demo@phoenixsectech.com / Demo1234!"
Write-Host ""
Write-Host "Phone must be on the same Wi-Fi (firewall rule for 4000 is already in place)."
Write-Host "Optional admin dashboard:  cd admin-web; npm run dev   (then http://localhost:5173)"
Write-Host "Stop everything:  .\stop-stack.ps1"
