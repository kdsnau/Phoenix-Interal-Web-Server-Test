#!/usr/bin/env bash
#
# Phoenix portal — backup RESTORE-TEST.
# A backup you've never restored is a hope, not a backup. This restores the
# NEWEST pg_dump into a throwaway scratch database, sanity-checks the row
# counts, then drops it. Exits non-zero (and logs loudly) if anything is off,
# so a silently-corrupt or truncated dump gets caught before you need it.
#
# Run on Saturn (Linux). Safe by hand or from cron. Reads DB_* from server/.env
# exactly like backup-db.sh (literal read, never `source`).
#
# One-time setup:
#   chmod +x server/scripts/verify-backup.sh
#   ./server/scripts/verify-backup.sh                    # test it once
#   # the DB role needs CREATEDB (one time, as postgres):
#   #   sudo -u postgres psql -c 'ALTER ROLE your_db_user CREATEDB;'
#   crontab -e   # then add (4:00am on the 1st of each month):
#   0 4 1 * * /full/path/to/server/scripts/verify-backup.sh >> "$HOME/phoenix-backups/verify.log" 2>&1
#
# Overrides: BACKUP_DIR=/mnt/nas/phoenix VERIFY_DB=scratch ./verify-backup.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Read a single DB_* value literally from .env (never `source` — a value with a
# space would execute). Existing environment variables win.
read_env() {
    [ -f "$ENV_FILE" ] || return 0
    local v
    v="$(sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?$1=//p" "$ENV_FILE" | head -n1)"
    v="${v%$'\r'}"
    v="${v%\"}"; v="${v#\"}"
    v="${v%\'}"; v="${v#\'}"
    printf '%s' "$v"
}

DB_HOST="${DB_HOST:-$(read_env DB_HOST)}"
DB_PORT="${DB_PORT:-$(read_env DB_PORT)}"
DB_NAME="${DB_NAME:-$(read_env DB_NAME)}"
DB_USER="${DB_USER:-$(read_env DB_USER)}"
DB_PASSWORD="${DB_PASSWORD:-$(read_env DB_PASSWORD)}"

BACKUP_DIR="${BACKUP_DIR:-$HOME/phoenix-backups}"
DB="${DB_NAME:-phoenix}"
VERIFY_DB="${VERIFY_DB:-${DB}_verify}"

export PGPASSWORD="${DB_PASSWORD:-}"
CONN=(-h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}")

# Newest dump for this database.
LATEST="$(ls -1t "$BACKUP_DIR/${DB}-"*.sql.gz 2>/dev/null | head -n1 || true)"
[ -n "$LATEST" ] || { echo "ERROR: no backups found in $BACKUP_DIR (${DB}-*.sql.gz)" >&2; exit 1; }
echo "[$(date '+%F %T')] verifying restore of $LATEST"

# Cheap check first: is the gzip even intact?
gzip -t "$LATEST" || { echo "ERROR: $LATEST is not a valid gzip." >&2; exit 1; }

# Fresh scratch DB (drop any leftover from a previous crashed run).
psql "${CONN[@]}" -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\";"
psql "${CONN[@]}" -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$VERIFY_DB\";"

# Always drop the scratch DB on the way out, even if a check below fails.
cleanup() { psql "${CONN[@]}" -d postgres -q -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\";" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Restore. ON_ERROR_STOP makes a single bad statement fail the whole load.
if ! gunzip -c "$LATEST" | psql "${CONN[@]}" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q >/dev/null; then
    echo "ERROR: restore FAILED — the backup did not load cleanly." >&2
    exit 1
fi

# Sanity: key tables must exist with plausible row counts. A truncated dump or
# an auth failure that produced an almost-empty file trips these.
FAIL=0
check() {   # table  min-rows
    local n
    n="$(psql "${CONN[@]}" -d "$VERIFY_DB" -tAc "SELECT count(*) FROM $1" 2>/dev/null || echo -1)"
    printf '  %-22s %s (min %s)\n' "$1" "$n" "$2"
    if ! [ "$n" -ge "$2" ] 2>/dev/null; then
        echo "ERROR: $1 has $n rows (expected >= $2) — backup looks incomplete." >&2
        FAIL=1
    fi
}
check clients             50
check users                1
check client_transactions  0     # must exist; 0 is fine
check client_monitoring    0

if [ "$FAIL" -ne 0 ]; then
    echo "[$(date '+%F %T')] VERIFY FAILED for $LATEST" >&2
    exit 1
fi
echo "[$(date '+%F %T')] VERIFY OK — $LATEST restores cleanly and looks complete."
