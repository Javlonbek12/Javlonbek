#!/usr/bin/env bash
# Read-only overview of the server. Runs ON THE SERVER, sent by .github/workflows/server.yml ("status").
# Never prints .env values.
APP="$HOME/assistant"
COMPOSE="docker compose -f docker-compose.prod.yml"

printf '=== Server ===\n'
grep PRETTY_NAME /etc/os-release
uptime
free -h
df -h /
command -v ufw > /dev/null && ufw status | head -8

printf '\n=== Docker ===\n'
if ! command -v docker > /dev/null; then
  echo "Docker is not installed yet (run the 'setup' action)."
  exit 0
fi
docker --version

if [ ! -f "$APP/docker-compose.prod.yml" ]; then
  echo "Assistant is not installed yet (run the 'setup' action)."
  exit 0
fi
cd "$APP" || exit 0
printf '\n=== Assistant ===\n'
echo "Code version: $(cat REVISION 2> /dev/null || echo unknown)"
domain=$(grep -E '^DOMAIN=' .env 2> /dev/null | cut -d= -f2-)
echo "Domain: ${domain:-not set}"
$COMPOSE ps -a
[ -n "$domain" ] && { printf 'Health: '; curl -sS -m 10 "https://$domain/api/health" || echo "no answer"; echo; }

printf '\n=== Backups ===\n'
crontab -l 2> /dev/null | grep backup || echo "daily backup is not scheduled"
ls -lh "$HOME/assistant-backups" 2> /dev/null | tail -4

for service in app worker watchdog caddy; do
  printf '\n=== Last log lines: %s ===\n' "$service"
  $COMPOSE logs --tail 15 --no-log-prefix "$service" 2>&1
done
