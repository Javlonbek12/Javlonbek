#!/usr/bin/env bash
# Updates the server to the latest code: pull (when the folder is a git clone), build,
# migrate, restart. GitHub Actions copies the new code first and then runs this script.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ -d .git ]; then git pull --ff-only; fi
$COMPOSE build
$COMPOSE run --rm migrate
$COMPOSE up -d --remove-orphans
# Re-register the bot webhook and its command menu (safe to repeat).
$COMPOSE run --rm -T app npm run --silent bot:set-webhook || echo "Bot webhook/commands not updated."
# Free disk space taken by old image layers and by the build cache (it grows with every deploy);
# the cache of the last 3 days stays, so the next build is still quick.
docker image prune -f > /dev/null
docker builder prune -f --filter until=72h > /dev/null || true
$COMPOSE ps
