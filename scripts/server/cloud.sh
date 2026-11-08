#!/usr/bin/env bash
# Runs on the GitHub runner, never on the server: the encrypted copy of the server's backups in
# S3-compatible cloud storage (Cloudflare R2, Backblaze B2, AWS S3, Yandex Object Storage…).
# The storage keys and the archive password live only in GitHub secrets, so neither the server
# nor the storage provider can read the data.
#
#   cloud.sh configured          exit 0 when the storage secrets are set
#   cloud.sh upload              the server's latest backup → backup-<stamp>.7z, then prune
#   cloud.sh list                the archives in the storage, newest first
#   cloud.sh download STAMP DIR  fetch backup-<STAMP>.7z and unpack it into DIR
#
# Secrets (env): BACKUP_S3_BUCKET, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET, BACKUP_S3_ENDPOINT
# (empty for AWS), BACKUP_S3_REGION (default "auto"), BACKUP_PASSWORD (the archive password).
# Kept: every day for CLOUD_KEEP_DAYS (30) days, after that the 1st of each month.
set -euo pipefail

BUCKET="${BACKUP_S3_BUCKET:-}"
PREFIX="assistant"
KEEP_DAYS="${CLOUD_KEEP_DAYS:-30}"
STAMP_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$'

configured() {
  [ -n "$BUCKET" ] && [ -n "${BACKUP_S3_KEY_ID:-}" ] && [ -n "${BACKUP_S3_SECRET:-}" ]
}

s3() {
  local endpoint=()
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && endpoint=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  AWS_ACCESS_KEY_ID="$BACKUP_S3_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET" \
    AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" aws "${endpoint[@]}" "$@"
}

need_password() {
  if [ "${#BACKUP_PASSWORD}" -lt 12 ]; then
    echo "Add the BACKUP_PASSWORD secret (at least 12 characters) first."
    exit 1
  fi
  command -v 7z > /dev/null || sudo apt-get install -y -q p7zip-full > /dev/null
}

# Stamps of the archives in the storage, newest first.
stamps() {
  s3 s3 ls "s3://$BUCKET/$PREFIX/" | awk '{print $4}' \
    | sed -n 's/^backup-\(.*\)\.7z$/\1/p' | grep -E "$STAMP_RE" | sort -r || true
}

case "${1:-}" in
  configured)
    configured ;;
  upload)
    need_password
    db="$(ssh vps 'ls -t ~/assistant-backups/db-*.sql.gz 2> /dev/null | head -1')"
    [ -n "$db" ] || { echo "No backups on the server yet"; exit 1; }
    stamp="$(basename "$db" .sql.gz)"
    stamp="${stamp#db-}"
    if stamps | grep -qx "$stamp"; then
      echo "Already in the cloud: backup-$stamp.7z"
    else
      work="$(mktemp -d)"
      mkdir -p "$work/files"
      ssh vps "cd ~/assistant-backups && tar -cf - db-$stamp.sql.gz \$(ls uploads-$stamp.tar.gz 2> /dev/null)" \
        | tar -xf - -C "$work/files"
      # AES-256 with hidden file names: without the password the archive says nothing.
      (cd "$work/files" && 7z a -t7z -mhe=on -p"$BACKUP_PASSWORD" "$work/backup-$stamp.7z" . > /dev/null)
      s3 s3 cp --only-show-errors "$work/backup-$stamp.7z" "s3://$BUCKET/$PREFIX/backup-$stamp.7z"
      echo "Uploaded: backup-$stamp.7z ($(du -h "$work/backup-$stamp.7z" | cut -f1))"
      rm -rf "$work"
    fi
    # Prune: daily copies older than KEEP_DAYS go, except the first of each month.
    cutoff="$(date -u -d "-$KEEP_DAYS days" +%Y-%m-%d)"
    for s in $(stamps); do
      day="${s%%_*}"
      if [[ "$day" < "$cutoff" ]] && [ "${day:8:2}" != "01" ]; then
        s3 s3 rm --only-show-errors "s3://$BUCKET/$PREFIX/backup-$s.7z"
        echo "Removed old copy: backup-$s.7z"
      fi
    done
    echo "In the cloud now:"
    stamps | head -40
    # A note for the owner's «Сервер и бэкапы» card in the settings (the app reads the backup folder).
    latest="$(stamps | head -1)"
    bytes="$(s3 s3 ls "s3://$BUCKET/$PREFIX/backup-$latest.7z" | awk '{print $3}' | head -1)"
    printf '{"latest":"%s","bytes":%s,"copies":%s,"checkedAt":"%s"}\n' \
      "$latest" "${bytes:-0}" "$(stamps | wc -l)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      | ssh vps 'cat > ~/assistant-backups/cloud-status.json' ;;
  list)
    stamps ;;
  download)
    stamp="${2:?stamp}"
    dir="${3:?dir}"
    [[ "$stamp" =~ $STAMP_RE ]] || { echo "Bad backup name: $stamp"; exit 1; }
    need_password
    mkdir -p "$dir"
    s3 s3 cp --only-show-errors "s3://$BUCKET/$PREFIX/backup-$stamp.7z" "$dir/backup.7z"
    (cd "$dir" && 7z x -p"$BACKUP_PASSWORD" -y backup.7z > /dev/null && rm backup.7z) \
      || { echo "Can't open backup-$stamp.7z: is BACKUP_PASSWORD the one it was made with?"; exit 1; }
    ls "$dir" ;;
  *)
    echo "Usage: cloud.sh configured|upload|list|download STAMP DIR"
    exit 1 ;;
esac
