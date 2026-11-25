#!/bin/sh
# Copy client blocks from alpha into client-blocks/ (read-only on the server side).
# Usage: deploy/sync-client-blocks.sh [ssh-alias]   (default alias: alpha-grid)
set -eu
HOST="${1:-alpha-grid}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/client-blocks"
mkdir -p "$DIR"
ssh "$HOST" 'cd /srv/apps/codegreene-app/sites-data 2>/dev/null && find . -path "*/blocks/*" -type f \( -name "block.*" -o -name meta.json \) -print0 | tar --null -czf - -T - 2>/dev/null || true' \
  > /tmp/cg-blocks.$$.tgz
if tar --version 2>/dev/null | grep -q bsdtar; then tar -xzf /tmp/cg-blocks.$$.tgz -C "$DIR" -s '#/blocks/#/#'
else tar -xzf /tmp/cg-blocks.$$.tgz -C "$DIR" --transform 's#/blocks/#/#'; fi
rm -f /tmp/cg-blocks.$$.tgz
echo "Client blocks synced into $DIR"
