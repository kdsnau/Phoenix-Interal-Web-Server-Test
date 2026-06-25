# Local dev database (isolated cluster)

This machine's existing PostgreSQL 18 service (`postgresql-x64-18`, port 5432) is
used by `phoenix_portal` and its superuser password was not available. So for door
development we run a **separate, throwaway Postgres cluster** that doesn't touch
the existing one.

- **Data dir:** `C:\Users\Ragna\phx-door-pgdata`
- **Port:** `5433`
- **Superuser:** `postgres` / `postgres`
- **Database:** `phx_door`
- **Backend points at it via** `backend/.env`:
  `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/phx_door`

Binaries live in `C:\Program Files\PostgreSQL\18\bin`.

```powershell
$BIN = "C:\Program Files\PostgreSQL\18\bin"
$DATA = "C:\Users\Ragna\phx-door-pgdata"

# start / stop / status
& "$BIN\pg_ctl.exe" -D $DATA -o "-p 5433" -l "$DATA\server.log" start
& "$BIN\pg_ctl.exe" -D $DATA stop
& "$BIN\pg_ctl.exe" -D $DATA status
```

It does NOT auto-start on reboot. To remove it entirely: stop it, then delete the
data dir.

## For real client deployments

Each client has their own Postgres. There, use the portable provisioning script
(`backend/scripts/create-db.sql`, run once by that client's superuser) which makes
a dedicated least-privilege `phx` role + `phx_door` database, then
`npm run migrate && npm run seed-admin`. The throwaway cluster above is only a dev
convenience for this machine.
