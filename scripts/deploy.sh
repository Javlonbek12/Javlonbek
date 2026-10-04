#!/usr/bin/env bash
# Updates the server to the latest code: pull, build, migrate, restart.
# Run on the server from the project folder (GitHub Actions does it after every push to main).
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

git pull --ff-only
$COMPOSE build
$COMPOSE run --rm migrate
$COMPOSE up -d --remove-orphans
# Free disk space taken by old image layers.
docker image prune -f > /dev/null
$COMPOSE ps
