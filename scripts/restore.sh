#!/usr/bin/env bash
# Restores a backup made by backup.sh. ALL CURRENT DATA IS REPLACED.
# Usage: scripts/restore.sh ~/assistant-backups/db-2026-10-05_0300.sql.gz [~/assistant-backups/uploads-2026-10-05_0300.tar.gz]
# From GitHub (Actions → Server → restore) it runs with RESTORE_YES=yes: the confirmation word is
# checked there.
set -euo pipefail

cd "$(dirname "$0")/.."
DB_FILE="${1:?Specify the db-*.sql.gz file}"
UPLOADS_FILE="${2:-}"
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ "${RESTORE_YES:-}" != "yes" ]; then
  read -r -p "Replace all current data with $DB_FILE? Type yes: " answer
  [ "$answer" = "yes" ] || { echo "Cancelled."; exit 1; }
fi
[ -f "$DB_FILE" ] || { echo "No such file: $DB_FILE"; exit 1; }

# Stop everything that writes to the database while restoring.
$COMPOSE stop app worker watchdog
# Recreate an empty database and load the backup into it.
$COMPOSE exec -T postgres psql -U assistant -d postgres -v ON_ERROR_STOP=1 -q \
  -c 'DROP DATABASE IF EXISTS assistant WITH (FORCE)' -c 'CREATE DATABASE assistant'
gunzip -c "$DB_FILE" | $COMPOSE exec -T postgres psql -U assistant -d assistant -v ON_ERROR_STOP=1 -q

if [ -n "$UPLOADS_FILE" ]; then
  # Files from the backup overwrite current ones; files added later are kept.
  $COMPOSE run --rm --no-deps -T --entrypoint tar app -xzf - -C /data < "$UPLOADS_FILE"
fi

$COMPOSE up -d
echo "Restore done."
