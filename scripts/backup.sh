#!/usr/bin/env bash
# ============================================================================
# Garajım backup — consistent snapshot of the production state.
#
# Production state is exactly two things, both under ./data (bind-mounted into
# the api container as /data):
#
#   data/app.db        SQLite, WAL mode, written live by the running container
#   data/uploads/      scanned ruhsat / poliçe images  ← SENSITIVE
#
# A plain `cp data/app.db` is NOT a backup: in WAL mode the newest committed
# transactions live in app.db-wal, so a copied .db is stale at best and torn at
# worst. This script uses SQLite's online-backup machinery instead:
#
#   container method  docker exec … node → better-sqlite3 → VACUUM INTO
#                     (default when the api container is running: it runs in
#                     the same lock domain as the process doing the writing,
#                     which is the only way to be correct on Docker Desktop
#                     where host↔container file locking is not shared)
#   host method       sqlite3 ".backup"  (used when the container is down, or
#                     when forced with --method host)
#
# The result is one self-contained, timestamped tar.gz per run:
#
#   garajim-backup-20260817T192500Z.tar.gz
#     ├── app.db          fully checkpointed, no -wal/-shm needed
#     ├── MANIFEST.txt    what/when/how, integrity_check result, sizes
#     └── uploads/…       the images
#   garajim-backup-20260817T192500Z.tar.gz.sha256
#
# The archive contains TC kimlik numbers and home addresses (ruhsat scans).
# Treat it like the database itself: local disk only, mode 0600, never in the
# git work tree, never a third-party bucket by default.
#
# Usage:
#   scripts/backup.sh                       # snapshot → $BACKUP_DIR
#   scripts/backup.sh --dest /mnt/backups   # elsewhere
#   scripts/backup.sh --retention-days 90 --keep-min 14
#   scripts/backup.sh --method host --no-prune
#   scripts/backup.sh --help
#
# Cron (daily 04:30, log to a file, non-zero exit ⇒ cron emails you):
#   30 4 * * * /srv/mototracker/scripts/backup.sh >> /var/log/garajim-backup.log 2>&1
#
# Restore: scripts/restore.sh <archive>   (see also docs/operations.md)
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# --- configuration (env or flags; flags win) --------------------------------
BACKUP_DIR="${BACKUP_DIR:-$HOME/garajim-backups}"
DATA_DIR="${DATA_DIR:-$REPO_ROOT/data}"
DB_PATH="${DB_PATH:-$DATA_DIR/app.db}"
UPLOADS_DIR="${UPLOADS_DIR:-$DATA_DIR/uploads}"
CONTAINER="${CONTAINER:-mototracker-api}"
CONTAINER_DB="${CONTAINER_DB:-/data/app.db}"
CONTAINER_UPLOADS="${CONTAINER_UPLOADS:-/data/uploads}"
METHOD="${METHOD:-auto}"          # auto | container | host
RETENTION_DAYS="${RETENTION_DAYS:-30}"
KEEP_MIN="${KEEP_MIN:-7}"         # never prune below this many archives
PRUNE="${PRUNE:-1}"
PREFIX="garajim-backup-"

# --- pretty output (same conventions as bootstrap.sh) -----------------------
if [ -t 1 ]; then
  green=$(tput setaf 2); yellow=$(tput setaf 3); red=$(tput setaf 1); cyan=$(tput setaf 6); reset=$(tput sgr0)
else
  green=""; yellow=""; red=""; cyan=""; reset=""
fi
say()  { printf "%s» %s%s\n" "$cyan" "$*" "$reset"; }
ok()   { printf "%s✓ %s%s\n" "$green" "$*" "$reset"; }
warn() { printf "%s! %s%s\n" "$yellow" "$*" "$reset" >&2; }
fail() { printf "%s✗ %s%s\n" "$red" "$*" "$reset" >&2; exit 1; }

usage() {
  sed -n '3,45p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest|--backup-dir)  BACKUP_DIR="${2:?--dest needs a directory}"; shift 2 ;;
    --data-dir)           DATA_DIR="${2:?--data-dir needs a directory}"
                          DB_PATH="$DATA_DIR/app.db"; UPLOADS_DIR="$DATA_DIR/uploads"; shift 2 ;;
    --db)                 DB_PATH="${2:?--db needs a path}"; shift 2 ;;
    --uploads)            UPLOADS_DIR="${2:?--uploads needs a path}"; shift 2 ;;
    --container)          CONTAINER="${2:?--container needs a name}"; shift 2 ;;
    --method)             METHOD="${2:?--method needs auto|container|host}"; shift 2 ;;
    --retention-days)     RETENTION_DAYS="${2:?--retention-days needs a number}"; shift 2 ;;
    --keep-min)           KEEP_MIN="${2:?--keep-min needs a number}"; shift 2 ;;
    --no-prune)           PRUNE=0; shift ;;
    -h|--help)            usage 0 ;;
    *)                    printf "unknown argument: %s\n\n" "$1" >&2; usage 1 ;;
  esac
done

case "$METHOD" in auto|container|host) ;; *) fail "--method must be auto, container or host (got '$METHOD')" ;; esac
case "$RETENTION_DAYS" in ''|*[!0-9]*) fail "--retention-days must be a whole number" ;; esac
case "$KEEP_MIN" in ''|*[!0-9]*) fail "--keep-min must be a whole number" ;; esac

# --- destination ------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"

# Refuse to drop ruhsat scans somewhere `git add .` would happily pick up.
if [ -n "${ALLOW_BACKUP_IN_REPO:-}" ]; then
  :
elif case "$BACKUP_DIR/" in "$REPO_ROOT"/*) true ;; *) false ;; esac; then
  if ! (command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" check-ignore -q "$BACKUP_DIR"); then
    fail "$BACKUP_DIR is inside the repo and not git-ignored. Backups hold TC kimlik
   numbers and addresses — pick a destination outside the work tree (--dest),
   or add it to .gitignore. Override with ALLOW_BACKUP_IN_REPO=1."
  fi
fi
chmod 700 "$BACKUP_DIR" 2>/dev/null || warn "could not chmod 700 $BACKUP_DIR"

[ -f "$DB_PATH" ] || fail "database not found: $DB_PATH (set DATA_DIR or --db)"

# --- single-instance lock (cron overlap protection) -------------------------
LOCK_DIR="${LOCK_DIR:-${TMPDIR:-/tmp}/garajim-backup.lock}"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another backup is already running (lock: $LOCK_DIR). Remove it by hand if
   a previous run was killed: rm -rf '$LOCK_DIR'"
fi
printf "%s\n" "$$" > "$LOCK_DIR/pid" 2>/dev/null || true

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/garajim-backup.XXXXXX")"
TMP_ARCHIVE=""
CONTAINER_TMP=""

# shellcheck disable=SC2329  # invoked indirectly via `trap cleanup EXIT`
cleanup() {
  local rc=$?
  [ -n "$CONTAINER_TMP" ] && docker exec "$CONTAINER" rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true
  [ -n "$TMP_ARCHIVE" ] && rm -f "$TMP_ARCHIVE" "$TMP_ARCHIVE.sha256" || true
  rm -rf "$STAGE" || true
  rmdir "$LOCK_DIR/pid" 2>/dev/null || rm -f "$LOCK_DIR/pid" 2>/dev/null || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
  [ "$rc" -ne 0 ] && printf "%s✗ backup FAILED (exit %s) — nothing was written to %s%s\n" "$red" "$rc" "$BACKUP_DIR" "$reset" >&2
  return 0
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# --- pick the snapshot method ----------------------------------------------
container_running() {
  command -v docker >/dev/null 2>&1 || return 1
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ]
}

if [ "$METHOD" = "auto" ]; then
  if container_running; then METHOD=container
  elif command -v sqlite3 >/dev/null 2>&1; then METHOD=host
  else
    fail "no way to take a consistent snapshot: container '$CONTAINER' is not running
   and the sqlite3 CLI is not installed. Start the container (docker compose up -d)
   or install sqlite3 (apt-get install sqlite3 / brew install sqlite)."
  fi
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="${PREFIX}${STAMP}.tar.gz"
say "Garajım backup — $STAMP (method: $METHOD)"

# --- 1. snapshot the database ----------------------------------------------
# Both paths produce a fully checkpointed $STAGE/app.db: every committed
# transaction folded in, no -wal/-shm sidecars needed to read it.
INTEGRITY="unknown"

if [ "$METHOD" = "container" ]; then
  container_running || fail "container '$CONTAINER' is not running (needed for --method container)"
  # Written inside the volume, not the container layer, so a large database
  # can't fill the image's writable layer. Removed again by cleanup().
  CONTAINER_TMP="$(dirname "$CONTAINER_DB")/.garajim-backup-$$-$STAMP.db"
  say "VACUUM INTO inside $CONTAINER …"
  SNAP_OUT="$(docker exec -i \
      -e SRC_DB="$CONTAINER_DB" -e DEST_DB="$CONTAINER_TMP" \
      -w /app "$CONTAINER" node - <<'NODE'
const fs = require("node:fs");
const Database = require("better-sqlite3");
const src = process.env.SRC_DB, dest = process.env.DEST_DB;
fs.rmSync(dest, { force: true });
const db = new Database(src);
db.pragma("busy_timeout = 30000");
// VACUUM INTO is the online-backup path: it reads a single consistent snapshot
// (WAL included) and writes a compact, checkpointed copy. The source database
// is untouched and stays writable throughout.
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
const out = new Database(dest, { readonly: true });
const integrity = out.pragma("integrity_check", { simple: true });
const tables = out.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c;
const bytes = out.pragma("page_count", { simple: true }) * out.pragma("page_size", { simple: true });
out.close();
if (integrity !== "ok") { console.error("integrity_check: " + integrity); process.exit(1); }
console.log(`integrity=${integrity} tables=${tables} bytes=${bytes}`);
NODE
  )" || fail "snapshot failed inside the container (see error above)"
  INTEGRITY="$(printf '%s' "$SNAP_OUT" | sed -n 's/.*integrity=\([a-z]*\).*/\1/p')"
  docker cp "$CONTAINER:$CONTAINER_TMP" "$STAGE/app.db" >/dev/null \
    || fail "docker cp of the snapshot out of $CONTAINER failed"
  docker exec "$CONTAINER" rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true
  CONTAINER_TMP=""
else
  command -v sqlite3 >/dev/null 2>&1 || fail "--method host needs the sqlite3 CLI on PATH"
  if container_running; then
    warn "container '$CONTAINER' is running — a host-side snapshot relies on the host and
   the container sharing file locks. That holds on Linux bind mounts, but NOT on
   Docker Desktop (macOS/Windows). Prefer --method container there."
  fi
  say "sqlite3 .backup on the host …"
  # .backup uses the online backup API and retries when a writer holds the lock.
  sqlite3 -cmd ".timeout 30000" "$DB_PATH" ".backup '$STAGE/app.db'" \
    || fail "sqlite3 .backup failed"
  INTEGRITY="$(sqlite3 "$STAGE/app.db" "PRAGMA integrity_check;" | head -1)"
  [ "$INTEGRITY" = "ok" ] || fail "integrity_check on the snapshot returned: $INTEGRITY"
fi

[ -s "$STAGE/app.db" ] || fail "snapshot is empty — refusing to write a useless backup"
ok "database snapshot: $(du -h "$STAGE/app.db" | awk '{print $1}') (integrity_check: $INTEGRITY)"

# --- 2. collect uploads -----------------------------------------------------
if [ -d "$UPLOADS_DIR" ]; then
  UPLOADS_PARENT="$(cd "$(dirname "$UPLOADS_DIR")" && pwd -P)"
  UPLOADS_NAME="$(basename "$UPLOADS_DIR")"
  UPLOADS_SRC="$UPLOADS_DIR"
elif container_running; then
  # Host path is absent (named volume, or running the script from elsewhere).
  say "uploads not on the host — copying $CONTAINER:$CONTAINER_UPLOADS …"
  docker cp "$CONTAINER:$CONTAINER_UPLOADS" "$STAGE/uploads" >/dev/null \
    || fail "docker cp of uploads failed"
  UPLOADS_PARENT="$STAGE"; UPLOADS_NAME="uploads"; UPLOADS_SRC="$CONTAINER:$CONTAINER_UPLOADS"
else
  warn "uploads directory not found ($UPLOADS_DIR) — archiving the database only"
  mkdir -p "$STAGE/uploads"
  UPLOADS_PARENT="$STAGE"; UPLOADS_NAME="uploads"; UPLOADS_SRC="(missing)"
fi
UPLOAD_FILES="$(find "$UPLOADS_PARENT/$UPLOADS_NAME" -type f 2>/dev/null | wc -l | tr -d ' ')"
ok "uploads: $UPLOAD_FILES files ($(du -sh "$UPLOADS_PARENT/$UPLOADS_NAME" 2>/dev/null | awk '{print $1}'))"

# --- 3. manifest ------------------------------------------------------------
{
  echo "app:              Garajım (mototracker)"
  echo "created_utc:      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host:             $(hostname 2>/dev/null || echo unknown)"
  echo "method:           $METHOD"
  echo "source_db:        $([ "$METHOD" = container ] && echo "$CONTAINER:$CONTAINER_DB" || echo "$DB_PATH")"
  echo "source_uploads:   $UPLOADS_SRC"
  echo "integrity_check:  $INTEGRITY"
  echo "db_bytes:         $(wc -c < "$STAGE/app.db" | tr -d ' ')"
  echo "upload_files:     $UPLOAD_FILES"
  echo "git_commit:       $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "contains:         app.db (checkpointed SQLite) + uploads/ (ruhsat scans — PII)"
  echo "restore:          scripts/restore.sh <this archive>   # see docs/operations.md"
} > "$STAGE/MANIFEST.txt"

# --- 4. archive, atomically ------------------------------------------------
# Written under a dot-prefixed temp name in the destination directory (same
# filesystem), then rename(2)d into place — a reader/rsync of $BACKUP_DIR never
# sees a half-written garajim-backup-*.tar.gz.
TMP_ARCHIVE="$BACKUP_DIR/.incomplete-$$-$NAME"
say "writing archive …"
COPYFILE_DISABLE=1 tar -czf "$TMP_ARCHIVE" \
  -C "$STAGE" app.db MANIFEST.txt \
  -C "$UPLOADS_PARENT" "$UPLOADS_NAME" \
  || fail "tar failed"
chmod 600 "$TMP_ARCHIVE"

tar -tzf "$TMP_ARCHIVE" >/dev/null || fail "the archive did not read back — not publishing it"

if command -v sha256sum >/dev/null 2>&1; then
  SUM="$(sha256sum "$TMP_ARCHIVE" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  SUM="$(shasum -a 256 "$TMP_ARCHIVE" | awk '{print $1}')"
else
  SUM=""
fi

mv -f "$TMP_ARCHIVE" "$BACKUP_DIR/$NAME"
if [ -n "$SUM" ]; then
  printf "%s  %s\n" "$SUM" "$NAME" > "$BACKUP_DIR/.incomplete-$$-$NAME.sha256"
  chmod 600 "$BACKUP_DIR/.incomplete-$$-$NAME.sha256"
  mv -f "$BACKUP_DIR/.incomplete-$$-$NAME.sha256" "$BACKUP_DIR/$NAME.sha256"
fi
TMP_ARCHIVE=""
ok "$BACKUP_DIR/$NAME ($(du -h "$BACKUP_DIR/$NAME" | awk '{print $1}'))"

# --- 5. prune ---------------------------------------------------------------
# Delete archives older than $RETENTION_DAYS, but never go below $KEEP_MIN —
# so a month of failed cron runs can't leave you with nothing.
if [ "$PRUNE" = "1" ]; then
  ARCHIVES="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PREFIX}*.tar.gz" | sort)"
  TOTAL="$(printf '%s\n' "$ARCHIVES" | grep -c . || true)"
  PRUNABLE="$((TOTAL - KEEP_MIN))"
  removed=0
  if [ "$PRUNABLE" -gt 0 ]; then
    # Names are UTC timestamps, so `sort` is chronological — the oldest
    # $PRUNABLE entries are the only candidates, then filter those by age.
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if [ -n "$(find "$f" -mtime "+$RETENTION_DAYS")" ]; then
        rm -f "$f" "$f.sha256"
        removed=$((removed + 1))
      fi
    done <<EOF
$(printf '%s\n' "$ARCHIVES" | head -n "$PRUNABLE")
EOF
  fi
  # Sweep temp files orphaned by a killed run (never the current one).
  find "$BACKUP_DIR" -maxdepth 1 -type f -name ".incomplete-*" -mtime +1 -delete 2>/dev/null || true
  if [ "$removed" -gt 0 ]; then
    ok "pruned $removed archive(s) older than $RETENTION_DAYS days (kept $((TOTAL - removed)))"
  else
    say "nothing to prune ($TOTAL archive(s), retention ${RETENTION_DAYS}d, keep-min $KEEP_MIN)"
  fi
fi

# --- optional off-box copy (deliberately not wired up) ----------------------
# Backups stay on this machine by default. If you want a second copy, pull it
# from a machine you own — no vendor SDK, no cloud credentials on the app host.
# Uncomment ONE of these and keep the destination encrypted at rest:
#
#   rsync -a --delete -e "ssh -i /root/.ssh/backup_ed25519" \
#     "$BACKUP_DIR/" backup@nas.lan:/volume1/garajim/
#
#   # Better: run the pull from the NAS so the app host holds no outbound creds.
#   # (on the NAS)  rsync -a app-host:/root/garajim-backups/ /volume1/garajim/
#
# Encrypt first if the target is not fully trusted (age is a single static bin):
#   age -r age1... "$BACKUP_DIR/$NAME" > "$BACKUP_DIR/$NAME.age"

exit 0
