# Cleanly stops the Phoenix Door test stack started by host-stack.ps1.
# IMPORTANT: stops Postgres GRACEFULLY (-m fast) so no child processes orphan and
# wedge the cluster on the next start. Does NOT touch your system PG on 5432.

$PG   = "C:\Program Files\PostgreSQL\18\bin"
$DATA = "C:\Users\Ragna\phx-door-pgdata"

# Backend (whatever is listening on 4000)
$pids = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -Expand OwningProcess -Unique
foreach ($procId in $pids) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
Write-Host "Backend stopped."

# Postgres on 5433 — graceful shutdown (no orphaned children)
& "$PG\pg_isready.exe" -h 127.0.0.1 -p 5433 | Out-Null
if ($LASTEXITCODE -eq 0) {
    & "$PG\pg_ctl.exe" -D $DATA -m fast stop
    Write-Host "Postgres (5433) stopped."
} else {
    Write-Host "Postgres (5433) was not running."
}
