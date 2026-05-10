#!/usr/bin/env bash
set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required but not installed."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required but not installed."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

echo "MotoTracker deployment env bootstrap"
echo
read -r -p "WEB_ORIGIN (e.g. https://moto-tracker-web.vercel.app): " WEB_ORIGIN
read -r -p "APP_BASE_URL (e.g. https://your-ngrok-domain.ngrok-free.app): " APP_BASE_URL
read -r -p "VAPID_SUBJECT (default: mailto:noreply@mototracker.app): " VAPID_SUBJECT
VAPID_SUBJECT="${VAPID_SUBJECT:-mailto:noreply@mototracker.app}"

echo
echo "Generating SESSION_SECRET and BETTER_AUTH_SECRET..."
SESSION_SECRET="$(openssl rand -base64 48)"
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"

echo "Generating VAPID keys via web-push..."
VAPID_OUTPUT="$(npx --yes web-push generate-vapid-keys)"
VAPID_PUBLIC_KEY="$(printf "%s\n" "${VAPID_OUTPUT}" | awk '/Public Key:/{getline; print $0}')"
VAPID_PRIVATE_KEY="$(printf "%s\n" "${VAPID_OUTPUT}" | awk '/Private Key:/{getline; print $0}')"

if [[ -z "${VAPID_PUBLIC_KEY}" || -z "${VAPID_PRIVATE_KEY}" ]]; then
  echo "Failed to parse VAPID keys from web-push output."
  exit 1
fi

cat >"${ENV_FILE}" <<EOF
WEB_ORIGIN=${WEB_ORIGIN}
APP_BASE_URL=${APP_BASE_URL}
SESSION_SECRET=${SESSION_SECRET}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}

RESEND_API_KEY=
EMAIL_FROM="MotoTracker <noreply@example.com>"
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

CLOUDFLARED_TOKEN=

OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_VISION_MODEL=gemma4
OCR_AUTO_APPLY_THRESHOLD=0.7

VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
VAPID_SUBJECT=${VAPID_SUBJECT}
CRON_TIMEZONE=Europe/Istanbul
CRON_HOUR=9
CRON_ENABLED=true
EOF

echo
echo "Wrote ${ENV_FILE}"
echo "Next steps:"
echo "  1) docker compose up -d --build api"
echo "  2) docker compose exec api node dist/db/migrate.js"
echo "  3) Set Vercel env:"
echo "     - VITE_API_URL=${APP_BASE_URL}"
echo "     - VITE_VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}"
