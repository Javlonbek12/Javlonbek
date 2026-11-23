#!/usr/bin/env bash
# Daily backup: database (pg_dump) + uploaded files. Keeps the last 14 days.
# Run from the project folder; cron example is in docs/SETUP-SERVER.md.
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-$HOME/assistant-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
COMPOSE="docker compose -f docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"

# Database: plain SQL, compressed.
$COMPOSE exec -T postgres pg_dump -U assistant assistant \
  | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz.part"
mv "$BACKUP_DIR/db-$STAMP.sql.gz.part" "$BACKUP_DIR/db-$STAMP.sql.gz"

# Uploaded files (pack pictures, attachments).
# Small copies of pictures (.thumbs) are made again on demand: not backed up.
$COMPOSE exec -T app tar -czf - --exclude='uploads/.thumbs' -C /data uploads > "$BACKUP_DIR/uploads-$STAMP.tar.gz.part"
mv "$BACKUP_DIR/uploads-$STAMP.tar.gz.part" "$BACKUP_DIR/uploads-$STAMP.tar.gz"

# Remove backups older than KEEP_DAYS days.
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "Backup done: $BACKUP_DIR/db-$STAMP.sql.gz, $BACKUP_DIR/uploads-$STAMP.tar.gz"
