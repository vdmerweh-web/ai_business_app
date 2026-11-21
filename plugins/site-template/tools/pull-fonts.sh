#!/bin/sh
# Copies a website's self-hosted fonts (set in the Planet Grid app: Blog > Fonts) into <site-folder>/fonts.
# Usage: pull-fonts.sh <domain> <site-folder>     Visitors then load fonts from the site itself, never from Google.
set -eu
DOM="$1"; SITE="$2"; BASE="https://api.planet-grid.com/public/fonts/$DOM"
case "$DOM" in *[!a-z0-9.-]*|"") echo "bad domain" >&2; exit 1;; esac
mkdir -p "$SITE/fonts"; TMP=$(mktemp -d)
curl -fsS "$BASE/fonts.css" -o "$TMP/fonts.css"
for f in $(grep -o 'url([a-z0-9]\{16\}\.woff2)' "$TMP/fonts.css" | sed 's/url(\(.*\))/\1/' | sort -u); do curl -fsS "$BASE/$f" -o "$TMP/$f"; done
rm -f "$SITE/fonts/"*.woff2; mv "$TMP"/* "$SITE/fonts/"; rmdir "$TMP"
echo "Fonts for $DOM copied to $SITE/fonts. Page <head> needs: <link rel=\"stylesheet\" href=\"fonts/fonts.css\">"
