#!/usr/bin/env bash
#
# Phoenix portal — PostgreSQL backup with rotation.
# Reads DB_* from the server's .env, writes a gzipped pg_dump, keeps the
# last KEEP backups. Run on Saturn (Linux). Safe to run by hand or from cron.
#
# One-time setup:
#   chmod +x server/scripts/backup-db.sh
#   ./server/scripts/backup-db.sh                 # test it once
#   crontab -e   # then add (3:15am daily):
#   15 3 * * * /full/path/to/server/scripts/backup-db.sh >> "$HOME/phoenix-backups/backup.log" 2>&1
#
# Override the destination or retention with env vars:
#   BACKUP_DIR=/mnt/nas/phoenix KEEP=30 ./server/scripts/backup-db.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Pull just the DB_* settings from the server .env. We deliberately DON'T
# `source` the file — a value with a space or shell metacharacter would get
# executed as a command. This reads each value literally. Existing environment
# variables win, so you can still override any of them inline.
read_env() {
    [ -f "$ENV_FILE" ] || return 0
    local v
    v="$(sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?$1=//p" "$ENV_FILE" | head -n1)"
    v="${v%$'\r'}"               # tolerate CRLF line endings
    v="${v%\"}"; v="${v#\"}"     # strip one layer of surrounding quotes
    v="${v%\'}"; v="${v#\'}"
    printf '%s' "$v"
}

DB_HOST="${DB_HOST:-$(read_env DB_HOST)}"
DB_PORT="${DB_PORT:-$(read_env DB_PORT)}"
DB_NAME="${DB_NAME:-$(read_env DB_NAME)}"
DB_USER="${DB_USER:-$(read_env DB_USER)}"
DB_PASSWORD="${DB_PASSWORD:-$(read_env DB_PASSWORD)}"

BACKUP_DIR="${BACKUP_DIR:-$HOME/phoenix-backups}"   # default: OUTSIDE the git repo
KEEP="${KEEP:-14}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
DB="${DB_NAME:-phoenix}"
OUT="$BACKUP_DIR/${DB}-${STAMP}.sql.gz"

echo "[$(date '+%F %T')] dumping ${DB} -> ${OUT}"
PGPASSWORD="${DB_PASSWORD:-}" pg_dump \
    -h "${DB_HOST:-localhost}" \
    -p "${DB_PORT:-5432}" \
    -U "${DB_USER:-postgres}" \
    -d "$DB" \
    --no-owner --no-privileges \
    | gzip > "$OUT"

# Fail loudly if the dump came out suspiciously small (e.g. auth failure).
if [ "$(stat -c '%s' "$OUT" 2>/dev/null || echo 0)" -lt 1024 ]; then
    echo "ERROR: backup is under 1KB — likely failed. Keeping it for inspection." >&2
    exit 1
fi

# Rotate: keep the newest $KEEP dumps, delete the rest.
ls -1t "$BACKUP_DIR/${DB}-"*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[$(date '+%F %T')] ok — $(du -h "$OUT" | cut -f1), keeping last ${KEEP}"
