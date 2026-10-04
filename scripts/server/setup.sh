#!/usr/bin/env bash
# Server setup, safe to run again. Runs ON THE SERVER as root: sent over SSH by
# .github/workflows/server.yml ("setup"), after the project files were copied to ~/assistant.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APP="$HOME/assistant"
PROVIDED="$HOME/.assistant-provided.env"
COMPOSE="docker compose -f docker-compose.prod.yml"

step() { printf '\n=== %s ===\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (secret VPS_USER=root)."
  exit 1
fi

step "System packages"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq git curl ufw openssl cron

step "Firewall: only SSH (22), HTTP (80), HTTPS (443)"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ufw status

mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
step "Swap (extra memory on disk for building and speech recognition)"
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ "$mem_kb" -lt 8000000 ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon --show

step "Docker"
if ! command -v docker > /dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
docker --version
docker compose version

step "Settings (.env)"
cd "$APP"
[ -f .env ] || cp .env.example .env
chmod 600 .env
get_kv() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
set_kv() {
  grep -v -E "^$1=" .env > .env.tmp || true
  printf '%s=%s\n' "$1" "$2" >> .env.tmp
  mv .env.tmp .env
  chmod 600 .env
}
# Generated once and kept: changing them later would lock out the database or log everyone out.
[ -n "$(get_kv SESSION_SECRET)" ] || set_kv SESSION_SECRET "$(openssl rand -hex 32)"
[ -n "$(get_kv POSTGRES_PASSWORD)" ] || set_kv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
[ -n "$(get_kv TELEGRAM_WEBHOOK_SECRET)" ] || set_kv TELEGRAM_WEBHOOK_SECRET "$(openssl rand -hex 16)"
# Values from the GitHub secrets (empty ones are skipped, so they never erase a value).
if [ -f "$PROVIDED" ]; then
  while IFS='=' read -r key value; do
    [ -n "$key" ] && [ -n "$value" ] && set_kv "$key" "$value"
  done < "$PROVIDED"
  rm -f "$PROVIDED"
fi
DOMAIN="$(get_kv DOMAIN)"
set_kv APP_URL "https://$DOMAIN"
set_kv ALLOW_DEV_LOGIN false
# Own speech recognition when there is enough memory (unless another provider was chosen).
if [ "$(get_kv STT_PROVIDER)" = "mock" ] || [ -z "$(get_kv STT_PROVIDER)" ]; then
  if [ "$mem_kb" -ge 3500000 ]; then
    set_kv STT_PROVIDER whisper
    set_kv WHISPER_URL http://whisper:8000
    set_kv COMPOSE_PROFILES whisper
  else
    echo "Less than 4 GB of memory: own speech recognition is not started."
  fi
fi
echo "Domain: $DOMAIN"
echo "Speech recognition: $(get_kv STT_PROVIDER)"
echo "Telegram bot: $( [ -n "$(get_kv TELEGRAM_BOT_TOKEN)" ] && echo set || echo NOT SET)"
echo "Claude key: $( [ -n "$(get_kv ANTHROPIC_API_KEY)" ] && echo set || echo NOT SET)"

step "Build and start (first time 5-10 minutes)"
chmod +x scripts/*.sh
$COMPOSE build
$COMPOSE run --rm migrate
$COMPOSE up -d --remove-orphans
docker image prune -f > /dev/null

if [ "$(get_kv COMPOSE_PROFILES)" = "whisper" ]; then
  step "Speech recognition model (about 500 MB, once)"
  $COMPOSE exec -T whisper uv run --no-sync python -c \
    "from faster_whisper import WhisperModel; WhisperModel('Systran/faster-whisper-small'); print('model ready')" \
    || echo "Model download failed; it will be downloaded on the first voice message."
fi

step "Daily backup at 03:00 (kept 14 days)"
(crontab -l 2>/dev/null | grep -v 'assistant/scripts/backup.sh' || true
  echo "0 3 * * * $APP/scripts/backup.sh >> $HOME/backup.log 2>&1") | crontab -
crontab -l | grep backup

step "Waiting for the site and the HTTPS certificate"
ok=""
for _ in $(seq 1 36); do
  if curl -fsS -m 10 "https://$DOMAIN/api/health" 2> /dev/null; then
    ok=1
    break
  fi
  sleep 5
done
echo
[ -n "$ok" ] || echo "The site does not answer over HTTPS yet. Check that the domain points to this server."

if [ -n "$(get_kv TELEGRAM_BOT_TOKEN)" ]; then
  step "Telegram webhook"
  $COMPOSE run --rm -T app npm run --silent bot:set-webhook
fi

step "Done"
$COMPOSE ps
echo
echo "Site: https://$DOMAIN"
