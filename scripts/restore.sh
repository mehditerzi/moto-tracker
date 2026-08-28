#!/usr/bin/env bash
# ============================================================================
# Garajım restore — put a scripts/backup.sh archive back into ./data.
#
# What it does, in order (each step is announced before it runs):
#
#   1. verify the archive (sha256 sidecar if present, tar readback, app.db
#      exists inside, PRAGMA integrity_check when sqlite3 is available)
#   2. stop the api container — nothing may hold the database open
#   3. move the CURRENT data aside to data/.pre-restore-<stamp>/ (not deleted:
#      if the restore was a mistake, move it back)
#   4. extract app.db + uploads/ into ./data, and delete any leftover
#      app.db-wal / app.db-shm — a stale WAL beside a restored database is
#      the classic way to corrupt it
#   5. fix ownership so the container (root inside the image) can write
#   6. start the container again and poll /api/health
#
# Usage:
#   scripts/restore.sh ~/garajim-backups/garajim-backup-20260817T192500Z.tar.gz
#   scripts/restore.sh <archive> --yes            # no prompt (scripted)
#   scripts/restore.sh <archive> --data-dir /srv/garajim/data
#   scripts/restore.sh <archive> --no-restart     # leave the stack down
#
# THIS OVERWRITES LIVE DATA. See docs/operations.md for the full runbook.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

DATA_DIR="${DATA_DIR:-$REPO_ROOT/data}"
CONTAINER="${CONTAINER:-mototracker-api}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.yml}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-api}"
OWNER="${OWNER:-0:0}"          # uid:gid the container runs as (image has no USER → root)
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/api/health}"
ASSUME_YES=0
RESTART=1
ARCHIVE=""

if [ -t 1 ]; then
  green=$(tput setaf 2); yellow=$(tput setaf 3); red=$(tput setaf 1); cyan=$(tput setaf 6); reset=$(tput sgr0)
else
  green=""; yellow=""; red=""; cyan=""; reset=""
fi
say()  { printf "%s» %s%s\n" "$cyan" "$*" "$reset"; }
ok()   { printf "%s✓ %s%s\n" "$green" "$*" "$reset"; }
warn() { printf "%s! %s%s\n" "$yellow" "$*" "$reset" >&2; }
fail() { printf "%s✗ %s%s\n" "$red" "$*" "$reset" >&2; exit 1; }

usage() { sed -n '3,27p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir)  DATA_DIR="${2:?--data-dir needs a directory}"; shift 2 ;;
    --container) CONTAINER="${2:?--container needs a name}"; shift 2 ;;
    --owner)     OWNER="${2:?--owner needs uid:gid}"; shift 2 ;;
    --yes|-y)    ASSUME_YES=1; shift ;;
    --no-restart) RESTART=0; shift ;;
    -h|--help)   usage 0 ;;
    -*)          printf "unknown argument: %s\n\n" "$1" >&2; usage 1 ;;
    *)           [ -z "$ARCHIVE" ] || fail "only one archive at a time"; ARCHIVE="$1"; shift ;;
  esac
done

[ -n "$ARCHIVE" ] || { printf "no archive given\n\n" >&2; usage 1; }
[ -f "$ARCHIVE" ] || fail "archive not found: $ARCHIVE"
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd -P)/$(basename "$ARCHIVE")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# --- 1. verify --------------------------------------------------------------
say "verifying $(basename "$ARCHIVE") …"
if [ -f "$ARCHIVE.sha256" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null) \
      || fail "checksum mismatch — this archive is damaged, do not restore it"
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$ARCHIVE")" && shasum -a 256 -c "$(basename "$ARCHIVE").sha256" >/dev/null) \
      || fail "checksum mismatch — this archive is damaged, do not restore it"
  fi
  ok "sha256 matches"
else
  warn "no .sha256 sidecar next to the archive — skipping checksum verification"
fi

LISTING="$(tar -tzf "$ARCHIVE")" || fail "archive is unreadable"
printf '%s\n' "$LISTING" | grep -qx "app.db" || fail "archive does not contain app.db at its root"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/garajim-restore.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"
[ -s "$STAGE/app.db" ] || fail "app.db in the archive is empty"

if command -v sqlite3 >/dev/null 2>&1; then
  res="$(sqlite3 "$STAGE/app.db" "PRAGMA integrity_check;" | head -1)"
  [ "$res" = "ok" ] || fail "integrity_check on the archived database: $res — refusing to restore"
  ok "integrity_check: ok"
else
  warn "sqlite3 not installed — skipping integrity_check (backup.sh already ran one at capture time)"
fi
if [ -f "$STAGE/MANIFEST.txt" ]; then echo; sed 's/^/    /' "$STAGE/MANIFEST.txt"; echo; fi

# --- 2. confirm -------------------------------------------------------------
if [ "$ASSUME_YES" != "1" ]; then
  [ -t 0 ] || fail "not a terminal — re-run with --yes if you really mean it"
  printf "%sThis REPLACES %s/app.db and %s/uploads. Type 'restore' to continue: %s" \
    "$yellow" "$DATA_DIR" "$DATA_DIR" "$reset"
  read -r answer
  [ "$answer" = "restore" ] || fail "aborted"
fi

# --- 3. stop the container --------------------------------------------------
STOPPED=0
if command -v docker >/dev/null 2>&1 \
   && [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ]; then
  say "stopping $CONTAINER …"
  if docker compose version >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" stop "$COMPOSE_SERVICE"
  else
    docker stop "$CONTAINER" >/dev/null
  fi
  STOPPED=1
  ok "container stopped"
else
  say "container '$CONTAINER' is not running — nothing to stop"
fi

# --- 4. move the current data aside, then extract ---------------------------
mkdir -p "$DATA_DIR"
SAFETY="$DATA_DIR/.pre-restore-$STAMP"
mkdir -p "$SAFETY"
for f in app.db app.db-wal app.db-shm uploads; do
  if [ -e "$DATA_DIR/$f" ]; then mv "$DATA_DIR/$f" "$SAFETY/$f"; fi
done
ok "previous state parked in $SAFETY"

mv "$STAGE/app.db" "$DATA_DIR/app.db"
# Belt and braces: a leftover WAL/SHM from the old database next to a restored
# app.db is read as that database's journal. Both were moved above; assert it.
rm -f "$DATA_DIR/app.db-wal" "$DATA_DIR/app.db-shm"
if [ -d "$STAGE/uploads" ]; then
  mv "$STAGE/uploads" "$DATA_DIR/uploads"
else
  mkdir -p "$DATA_DIR/uploads"
fi
ok "app.db + uploads/ restored into $DATA_DIR"

# --- 5. ownership -----------------------------------------------------------
# The runtime image declares no USER, so the api runs as root (uid 0) and the
# bind mount must be writable by it. On Docker Desktop (macOS) the mount is
# ownership-virtualized and chown is neither possible nor needed.
if [ "$(uname -s)" = "Darwin" ]; then
  say "macOS — skipping chown (Docker Desktop virtualizes bind-mount ownership)"
elif [ "$(id -u)" = "0" ]; then
  chown -R "$OWNER" "$DATA_DIR/app.db" "$DATA_DIR/uploads"
  chmod 600 "$DATA_DIR/app.db"
  ok "ownership set to $OWNER"
else
  warn "not root — run this to hand the files to the container user:
   sudo chown -R $OWNER '$DATA_DIR/app.db' '$DATA_DIR/uploads'"
fi

# --- 6. bring it back up ----------------------------------------------------
if [ "$RESTART" = "1" ]; then
  if command -v docker >/dev/null 2>&1 && { [ "$STOPPED" = "1" ] || docker inspect "$CONTAINER" >/dev/null 2>&1; }; then
    say "starting the api …"
    if docker compose version >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
      docker compose -f "$COMPOSE_FILE" up -d "$COMPOSE_SERVICE"
    else
      docker start "$CONTAINER" >/dev/null
    fi
    say "waiting for $HEALTH_URL …"
    for _ in $(seq 1 30); do
      if curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1; then
        ok "api healthy"; break
      fi
      sleep 1
    done
    curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1 \
      || warn "api did not answer $HEALTH_URL within 30s — check: docker compose logs -f api"
  fi
else
  say "--no-restart: the stack is still down. Start it with: docker compose up -d"
fi

echo
ok "restore complete."
printf "   Rolled back from: %s\n" "$ARCHIVE"
printf "   Previous state:   %s  (delete it once you are happy: rm -rf '%s')\n" "$SAFETY" "$SAFETY"
