#!/usr/bin/env bash
# Read-only overview of the server. Runs ON THE SERVER, sent by .github/workflows/server.yml ("status").
# Never prints .env values. The workflow log can be public: addresses are cut to their first half.
APP="$HOME/assistant"
COMPOSE="docker compose -f docker-compose.prod.yml"

# 203.0.113.7 → 203.0.x.x (who logged in, without giving the address away).
mask() { sed -E 's/([0-9]+\.[0-9]+)\.[0-9]+\.[0-9]+/\1.x.x/g'; }

printf '=== Server ===\n'
grep PRETTY_NAME /etc/os-release
uptime
echo "CPU cores: $(nproc)"
free -h
df -h /
command -v ufw > /dev/null && ufw status | head -8

printf '\n=== Logged in now (%s) and the last logins ===\n' "$(who | wc -l)"
who | mask
last -n 6 -i 2> /dev/null | grep -v '^$' | grep -v '^wtmp' | mask

printf '\n=== Docker ===\n'
if ! command -v docker > /dev/null; then
  echo "Docker is not installed yet (run the 'setup' action)."
  exit 0
fi
docker --version

printf '\n=== Disk: what takes the space ===\n'
docker system df
echo "Docker in total, its container logs, backups, system logs:"
du -xsh /var/lib/docker /var/lib/docker/containers "$HOME/assistant-backups" /var/log 2> /dev/null
echo "Data volumes:"
du -sh /var/lib/docker/volumes/assistant_* 2> /dev/null

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
printf '\nCPU and memory per service now:\n'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
[ -n "$domain" ] && { printf 'Health: '; curl -sS -m 10 "https://$domain/api/health" || echo "no answer"; echo; }

printf '\n=== Backups ===\n'
crontab -l 2> /dev/null | grep backup || echo "daily backup is not scheduled"
ls -lh "$HOME/assistant-backups" 2> /dev/null | tail -4

for service in app worker watchdog; do
  printf '\n=== Last log lines: %s ===\n' "$service"
  $COMPOSE logs --tail 15 --no-log-prefix "$service" 2>&1
done
# Caddy logs every request with its address, browser and headers: here only time, level, message,
# page and error.
printf '\n=== Last log lines: caddy ===\n'
$COMPOSE logs --tail 15 --no-log-prefix caddy 2>&1 | python3 -c '
import json, sys, datetime
for line in sys.stdin:
    try:
        e = json.loads(line)
    except ValueError:
        continue
    when = datetime.datetime.fromtimestamp(e.get("ts", 0), datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    page = (e.get("request") or {}).get("uri", "")
    print(when, e.get("level", ""), e.get("msg", ""), page, e.get("error", ""))
' 2> /dev/null || echo "(python3 is not installed: caddy lines skipped)"
