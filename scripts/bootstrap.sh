#!/usr/bin/env bash
# ============================================================================
# MotoTracker bootstrap — runs the app stack in Docker on a fresh device.
# Tested on macOS + Linux. Requires Docker (compose v2) and git already
# installed. Idempotent: safe to re-run on the same machine to bring the stack
# back up.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
ENV_FILE="$REPO_ROOT/.env"
EXAMPLE_FILE="$REPO_ROOT/.env.example"

# --- pretty output ----------------------------------------------------------
if [ -t 1 ]; then
  bold=$(tput bold); dim=$(tput dim); reset=$(tput sgr0)
  green=$(tput setaf 2); yellow=$(tput setaf 3); red=$(tput setaf 1); cyan=$(tput setaf 6)
else
  bold=""; dim=""; reset=""; green=""; yellow=""; red=""; cyan=""
fi
say()   { printf "%s» %s%s\n" "$cyan" "$*" "$reset"; }
ok()    { printf "%s✓ %s%s\n" "$green" "$*" "$reset"; }
warn()  { printf "%s! %s%s\n" "$yellow" "$*" "$reset"; }
fail()  { printf "%s✗ %s%s\n" "$red" "$*" "$reset" >&2; exit 1; }

# --- prerequisites ----------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "docker not found. Install Docker Desktop or docker-ce first."
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not found. Update Docker."

say "Docker $(docker --version | awk '{print $3}' | tr -d ,) detected."

# --- helpers ----------------------------------------------------------------
random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  elif [ -r /dev/urandom ]; then
    head -c "$1" /dev/urandom | xxd -p -c "$((2 * $1))" | tr -d '\n'
  else
    fail "Need openssl or /dev/urandom to generate secrets."
  fi
}

# Read a value from .env if it exists. Echoes nothing if absent or empty.
read_env() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  awk -F= -v k="$key" '$1==k { sub(/^[^=]+=/,""); print; exit }' "$ENV_FILE" | sed 's/^"//;s/"$//'
}

# Set (or replace) KEY=VALUE in .env. Sanitizes the value (drops control chars,
# trims whitespace) and quotes when it contains spaces.
set_env() {
  local key="$1" val
  val="$(sanitize "$2")"
  local quoted="$val"
  if [[ "$val" == *" "* ]]; then quoted="\"$val\""; fi
  if [ -f "$ENV_FILE" ] && grep -q "^${key}=" "$ENV_FILE"; then
    # In-place replace (portable BSD/GNU sed).
    tmp="$(mktemp)"
    awk -F= -v k="$key" -v v="$quoted" '
      BEGIN { OFS="=" }
      { if ($1==k) print k "=" v; else print $0 }
    ' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$quoted" >> "$ENV_FILE"
  fi
}

prompt() {
  local label="$1" default="${2:-}"
  local reply
  # The label goes to stderr so $(prompt ...) only captures the user's reply.
  if [ -n "$default" ]; then
    printf "%s%s%s [%s]: " "$bold" "$label" "$reset" "$default" >&2
  else
    printf "%s%s%s: " "$bold" "$label" "$reset" >&2
  fi
  read -r reply
  printf "%s" "$(sanitize "${reply:-$default}")"
}

# Strip ALL control characters (C0 + DEL: NUL..US, \t, \n, \r included) that
# can sneak in via paste from rich-text sources (e.g. ngrok dashboard → terminal).
# Then trim surrounding whitespace. Prevents downstream parsers (ngrok's YAML,
# dotenv, etc.) from blowing up with "control characters are not allowed".
sanitize() {
  local v
  v="$(printf "%s" "$1" | LC_ALL=C tr -d '[:cntrl:]')"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf "%s" "$v"
}

# --- create .env from .env.example if missing -------------------------------
if [ ! -f "$ENV_FILE" ]; then
  say "Creating .env from .env.example"
  cp "$EXAMPLE_FILE" "$ENV_FILE"
fi

# --- secrets ----------------------------------------------------------------
if [ -z "$(read_env SESSION_SECRET)" ]; then
  say "Generating SESSION_SECRET"
  set_env SESSION_SECRET "$(random_hex 32)"
  ok "SESSION_SECRET set"
fi

if [ -z "$(read_env VAPID_PUBLIC_KEY)" ] || [ -z "$(read_env VAPID_PRIVATE_KEY)" ]; then
  say "Generating VAPID keypair (npx web-push)"
  # Use a one-shot Node container so we don't rely on host node/npx.
  vapid_json="$(docker run --rm node:20-alpine sh -c "npm exec --yes -- web-push generate-vapid-keys --json" 2>/dev/null || true)"
  if [ -z "$vapid_json" ] && command -v npx >/dev/null 2>&1; then
    vapid_json="$(npx --yes web-push generate-vapid-keys --json)"
  fi
  [ -n "$vapid_json" ] || fail "Could not generate VAPID keys. Install Node or run inside a network with Docker Hub access."

  pub="$(echo "$vapid_json" | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')"
  priv="$(echo "$vapid_json" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p')"
  [ -n "$pub" ] && [ -n "$priv" ] || fail "Could not parse VAPID keys."
  set_env VAPID_PUBLIC_KEY "$pub"
  set_env VAPID_PRIVATE_KEY "$priv"
  ok "VAPID keypair stored"
fi

# --- ngrok authtoken --------------------------------------------------------
existing_token="$(read_env NGROK_AUTHTOKEN)"
# Re-prompt if the stored token contains control characters / whitespace from
# a bad copy-paste — ngrok will refuse to parse its auth-config.yml otherwise
# ("control characters are not allowed").
if [ -n "$existing_token" ] && \
   ! printf "%s" "$existing_token" | LC_ALL=C grep -qE '^[A-Za-z0-9_-]+$'; then
  warn "Stored NGROK_AUTHTOKEN contains unexpected characters — clearing it."
  set_env NGROK_AUTHTOKEN ""
  existing_token=""
fi
if [ -z "$existing_token" ]; then
  warn "NGROK_AUTHTOKEN is required. Sign in at https://dashboard.ngrok.com/get-started/your-authtoken"
  token="$(prompt "ngrok authtoken")"
  [ -n "$token" ] || fail "No authtoken provided."
  set_env NGROK_AUTHTOKEN "$token"
fi

# --- ngrok domain (optional but recommended) --------------------------------
existing_domain="$(read_env NGROK_DOMAIN)"
# Sanity-check: a valid ngrok hostname has no spaces and contains at least one
# dot. If we read something garbled (e.g. captured prompt text from an older
# buggy bootstrap), clear it so we re-prompt below.
if [ -n "$existing_domain" ]; then
  if printf "%s" "$existing_domain" | grep -q '[[:space:]]' || ! printf "%s" "$existing_domain" | grep -q '\.'; then
    warn "Stored NGROK_DOMAIN looks invalid ('$existing_domain') — clearing it."
    set_env NGROK_DOMAIN ""
    set_env APP_BASE_URL ""
    existing_domain=""
  fi
fi
if [ -z "$existing_domain" ]; then
  echo
  warn "No NGROK_DOMAIN set. ngrok will hand out an ephemeral URL that changes"
  warn "every restart. Reserve a free static subdomain at"
  warn "https://dashboard.ngrok.com/domains and paste it here (or press Enter to skip)."
  domain="$(prompt "ngrok domain (optional, e.g. honest-tarpon-44.ngrok-free.app)")"
  if [ -n "$domain" ]; then
    set_env NGROK_DOMAIN "$domain"
    set_env APP_BASE_URL "https://$domain"
    existing_domain="$domain"
  fi
else
  if [ -z "$(read_env APP_BASE_URL)" ]; then
    set_env APP_BASE_URL "https://$existing_domain"
  fi
fi

# --- write ngrok.yml (tunnel definition) ------------------------------------
# Docker compose can't conditionally include a CLI flag in `command:`, so we
# template the tunnel via ngrok's config file. version "2" is the classic
# format ("tunnels" map); ngrok agent 3.x accepts it for backward compat.
# (v3 config switches to "endpoints" — different shape, easy to get wrong.)
# The authtoken stays in the env (NGROK_AUTHTOKEN), so this file is safe to
# inspect; it's gitignored by default.
say "Writing ngrok.yml"
{
  echo "version: \"2\""
  echo "tunnels:"
  echo "  api:"
  echo "    proto: http"
  echo "    addr: api:8787"
  if [ -n "$existing_domain" ]; then
    echo "    domain: $existing_domain"
  fi
} > "$REPO_ROOT/ngrok.yml"
ok "ngrok.yml written ($([ -n "$existing_domain" ] && echo "reserved domain: $existing_domain" || echo "ephemeral URL"))"

# --- Ollama: host or bundled? ----------------------------------------------
# Prefer an Ollama already running on the host (cheaper, keeps GPU access,
# preserves any models the user has pulled). Fall back to a bundled
# container only when there's nothing listening on :11434.
USE_BUNDLED_OLLAMA=false
if curl -fsS --max-time 2 http://localhost:11434/api/version >/dev/null 2>&1; then
  ok "Found Ollama already running on host — api will connect to it"
  set_env OLLAMA_URL "http://host.docker.internal:11434"
else
  say "No host Ollama detected — will run a bundled container"
  set_env OLLAMA_URL "http://ollama:11434"
  USE_BUNDLED_OLLAMA=true
fi

COMPOSE_PROFILE_ARGS=""
if [ "$USE_BUNDLED_OLLAMA" = "true" ]; then
  COMPOSE_PROFILE_ARGS="--profile bundled-ollama"
fi

# --- compose up -------------------------------------------------------------
say "Building images (first run can take a few minutes)"
# shellcheck disable=SC2086
docker compose $COMPOSE_PROFILE_ARGS build

say "Starting stack"
# shellcheck disable=SC2086
docker compose $COMPOSE_PROFILE_ARGS up -d

# Discover ephemeral ngrok URL if none was reserved.
if [ -z "$existing_domain" ]; then
  say "Waiting for ngrok to publish a URL…"
  url=""
  for _ in $(seq 1 20); do
    sleep 1
    url="$(curl -fsS http://localhost:4040/api/tunnels 2>/dev/null \
      | sed -n 's/.*"public_url":"\(https:[^"]*\)".*/\1/p' | head -1 || true)"
    [ -n "$url" ] && break
  done
  if [ -n "$url" ]; then
    set_env APP_BASE_URL "$url"
    say "Restarting api with APP_BASE_URL=$url"
    docker compose up -d --force-recreate --no-deps api
  else
    warn "Couldn't auto-detect ngrok URL. Open http://localhost:4040 to find it,"
    warn "then update APP_BASE_URL in .env and run: docker compose up -d --force-recreate api"
  fi
fi

# --- Ollama model -----------------------------------------------------------
ollama_model="$(read_env OLLAMA_VISION_MODEL)"
ollama_model="${ollama_model:-gemma4:e4b}"
if [ "$USE_BUNDLED_OLLAMA" = "true" ]; then
  say "Pulling Ollama vision model ($ollama_model) into bundled container"
  docker exec mototracker-ollama ollama pull "$ollama_model" \
    || warn "ollama pull failed — pull manually later with: docker exec mototracker-ollama ollama pull $ollama_model"
else
  say "Using host Ollama — checking for $ollama_model"
  if curl -fsS http://localhost:11434/api/show -X POST -d "{\"model\":\"$ollama_model\"}" \
       >/dev/null 2>&1; then
    ok "Model $ollama_model is available on host Ollama"
  else
    warn "Model $ollama_model not found on host Ollama."
    warn "Pull it with:  ollama pull $ollama_model"
    warn "Or change OLLAMA_VISION_MODEL in .env to a tag you have."
  fi
fi

# --- final summary ----------------------------------------------------------
echo
final_url="$(read_env APP_BASE_URL)"
ok "MotoTracker is up."
printf "   %sPublic URL:%s %s\n" "$bold" "$reset" "$final_url"
printf "   %sngrok inspector:%s http://localhost:4040\n" "$bold" "$reset"
printf "   %sAPI (local):%s    http://localhost:8787\n" "$bold" "$reset"
if [ "$USE_BUNDLED_OLLAMA" = "true" ]; then
  printf "   %sOllama:%s         bundled container at http://localhost:11434\n" "$bold" "$reset"
else
  printf "   %sOllama:%s         using host (http://localhost:11434)\n" "$bold" "$reset"
fi
echo
printf "   %sLogs:%s          docker compose logs -f\n" "$dim" "$reset"
printf "   %sStop:%s          docker compose down\n" "$dim" "$reset"
echo
