#!/usr/bin/env bash
# Pull this repo and rebuild one app's Docker containers.
# Usage (on the server, from the repo root):
#   ./deploy/pull-and-build.sh core
#   ./deploy/pull-and-build.sh billing
# Never prints .env values. Never overwrites .env.
set -euo pipefail

APP="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$APP" != "core" && "$APP" != "billing" ]]; then
  echo "Usage: $0 core|billing" >&2
  exit 1
fi

DIR="$ROOT/apps/$APP"
if [[ ! -f "$DIR/docker-compose.yml" ]]; then
  echo "Missing $DIR/docker-compose.yml" >&2
  exit 1
fi
if [[ ! -f "$DIR/.env" ]]; then
  echo "Missing $DIR/.env — copy the example and fill it on this server first." >&2
  echo "This script will not create or change .env." >&2
  exit 1
fi

if [[ "$APP" == "billing" ]]; then
  # Billing must be switched on explicitly (Planet Grid only).
  FLAG="${ENABLE_BILLING:-}"
  if [[ -z "$FLAG" ]]; then
    FLAG="$(grep -E '^ENABLE_BILLING=' "$DIR/.env" | tail -n1 | cut -d= -f2- || true)"
  fi
  if [[ "$FLAG" != "1" ]]; then
    echo "Refusing to build billing because ENABLE_BILLING is not 1." >&2
    echo "This module stays off except on Planet Grid." >&2
    exit 1
  fi
fi

if [[ -d "$ROOT/.git" ]]; then
  git pull --ff-only
fi

cd "$DIR"
docker compose up -d --build

echo "Waiting for the web container to answer..."
# Core publishes 3601, billing publishes 3001. Try the published port from compose.
sleep 5
if [[ "$APP" == "core" ]]; then
  curl -fsS "http://127.0.0.1:3601/api/health" && echo
else
  curl -fsS "http://127.0.0.1:3001/api/health" || curl -fsS "http://127.0.0.1:3000/health" || curl -fsS "http://127.0.0.1:3000/api/health" || {
    echo "Containers started, but a health URL was not found. Check docker compose ps."
    docker compose ps
    exit 1
  }
  echo
fi
echo "Done. $APP is rebuilt from $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'the local tree')."
