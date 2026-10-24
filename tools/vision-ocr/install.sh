#!/usr/bin/env bash
# Build and (re)install the Apple Vision OCR service as a per-user LaunchAgent.
# It must run in the logged-in user's session: Vision needs no GUI, but the
# host's Docker containers reach it via host.docker.internal:11470.
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O main.swift -o garajim-vision-ocr
PLIST="$HOME/Library/LaunchAgents/com.ostamai.garajim-vision-ocr.plist"
cp com.ostamai.garajim-vision-ocr.plist "$PLIST"
launchctl bootout "gui/$(id -u)/com.ostamai.garajim-vision-ocr" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
for _ in $(seq 1 20); do
  curl -sf http://127.0.0.1:11470/health >/dev/null && { echo "✓ garajim-vision-ocr up on 127.0.0.1:11470"; exit 0; }
  sleep 0.5
done
echo "✗ service did not come up — see ~/Library/Logs/garajim-vision-ocr.log" >&2
exit 1
