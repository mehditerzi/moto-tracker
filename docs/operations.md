# Operations

Everything you need when the app is *running* rather than being written: what CI
checks, how backups work, how to put a backup back, and what to look at when the
app is unhealthy.

Three facts shape all of it:

- **The whole production state is `./data`.** `data/app.db` (SQLite, WAL mode)
  plus `data/uploads/` (the scanned documents). No cloud DB, no object store, no
  second replica. Lose that directory and the app is gone.
- **The uploads are sensitive.** They are ruhsat / poliçe photos: TC kimlik
  numbers, home addresses, plates. A backup archive is exactly as sensitive as
  the database — mode `0600`, local disk, never in the git work tree, never a
  third-party bucket.
- **The deployment unit is the Docker image.** If `apps/api/Dockerfile` stops
  building, nothing else matters — which is why CI builds it on every push.

---

## CI

`.github/workflows/ci.yml` runs on every push and pull request. Three jobs, in
parallel:

| Job | What it does |
|---|---|
| `verify` | pnpm install (frozen lockfile) → native-module smoke test → build shared → typecheck api + web → `pnpm -r run test` → build api + web |
| `docker` | builds `apps/api/Dockerfile` for `linux/amd64` with a buildx layer cache. `push: false` — it proves the image builds, it never publishes it |
| `scripts` | `shellcheck scripts/*.sh` |

CI is **verification only**. It does not deploy, publish, or call out to
anything; deploys stay `git pull && docker compose up -d --build` on the box.

### Running the same checks locally

The workflow deliberately uses plain pnpm commands, so you can run the whole
thing by hand:

```bash
pnpm install --frozen-lockfile

pnpm --filter @mototracker/shared build                      # api + web import its dist
pnpm --filter @mototracker/api exec tsc -p tsconfig.json --noEmit
pnpm --filter @mototracker/web exec tsc -p tsconfig.json --noEmit
pnpm -r run test                                             # shared (none) → api → web
pnpm --filter @mototracker/api build
pnpm --filter @mototracker/web build

shellcheck scripts/*.sh                                      # brew install shellcheck
docker build -f apps/api/Dockerfile .                        # the slow one, ~3-6 min cold
```

Notes worth knowing before you go hunting for a phantom failure:

- **Use that explicit order, not root `pnpm build`.** The root script is
  `pnpm -r --parallel run build`, and `apps/web`'s own build script starts by
  rebuilding `@mototracker/shared` — so the parallel form can put two `tsc`
  processes on `packages/shared/dist` at the same time. CI mirrors the
  Dockerfile's sequential order instead.
- **`apps/web build` typechecks too.** It is `shared build && tsc --noEmit &&
  vite build`, so the explicit web typecheck step above is deliberate
  duplication — it just makes the failure say *typecheck* instead of *build*.
- **`pnpm lint` proves nothing.** `apps/web`'s lint script is
  `echo 'no lint yet'`. Do not read a green lint as a signal.
- **The api tests need no `.env`.** With `NODE_ENV=test` (vitest sets it),
  `apps/api/src/config.ts` swaps in fixed test values —
  `DATABASE_PATH=:memory:`, `UPLOADS_DIR=/tmp/mototracker-test-uploads`,
  cron off. Tests never touch `./data`.
- **Native modules.** `better-sqlite3` and `sharp` both ship prebuilt binaries
  for linux-x64 and darwin-arm64, so no compiler is needed on the runner. CI
  loads both before running the suite so a missing prebuild fails with a clear
  message rather than 200 confusing test errors.

---

## Backups

`scripts/backup.sh` writes one self-contained, timestamped archive per run.

```bash
./scripts/backup.sh                          # → $HOME/garajim-backups/
./scripts/backup.sh --dest /mnt/usb/garajim  # somewhere else
./scripts/backup.sh --help
```

```text
garajim-backup-20260817T192500Z.tar.gz
  ├── app.db          fully checkpointed SQLite — no -wal/-shm needed to read it
  ├── MANIFEST.txt    when, how, from where, integrity_check result, git commit
  └── uploads/…       the scanned documents
garajim-backup-20260817T192500Z.tar.gz.sha256
```

### Why not just `cp data/app.db`

The database runs in **WAL mode** (`journal_mode = WAL`, set in
`apps/api/src/db/index.ts`). Committed transactions live in `app.db-wal` until a
checkpoint folds them back into `app.db`, so a copied `.db` is missing every
write since the last checkpoint — and if the copy happens mid-write, it can be
torn. On a live install here, `app.db-wal` was **4 MB against a 700 KB
database**: a naive `cp` of that file yielded 7 users and 6 vehicles where the
real state was 9 and 7.

So the script uses SQLite's online-backup machinery, one of two ways:

| Method | When | Mechanism |
|---|---|---|
| `container` (default when the api container is up) | normal operation | `docker exec` → node → `better-sqlite3` → `VACUUM INTO` |
| `host` | container stopped, or `--method host` | `sqlite3 ".backup"` with a 30 s busy timeout |

The container path exists for two reasons. First, the runtime image has no
`sqlite3` CLI — but it does have node and `better-sqlite3`, which is the same
library the app writes with. Second, and more importantly: a snapshot taken
*inside* the container shares a lock domain with the process doing the writing.
On Linux bind mounts the host shares that too, but on Docker Desktop
(macOS/Windows) host↔container file locking is not reliable, so taking the
snapshot in the container is the only universally correct option. Force either
with `--method container|host`.

Both paths verify the result with `PRAGMA integrity_check` before it is
archived, and the answer is recorded in `MANIFEST.txt`.

### Safety properties

- `set -euo pipefail`; **any** failure exits non-zero and writes nothing to the
  destination. Under cron, that means you get the mail.
- The archive is written as `.incomplete-<pid>-<name>` in the destination and
  `mv`'d into place only after `tar -tzf` reads it back — a sync or a restore
  never sees a half-written `garajim-backup-*.tar.gz`.
- A `mkdir` lock (`$TMPDIR/garajim-backup.lock`) makes overlapping cron runs
  fail loudly instead of interleaving. If a run was `kill -9`'d, remove the lock
  directory by hand.
- Temp files — inside the container and on the host — are removed by an `EXIT`
  trap, including on failure.
- It refuses to write into the git work tree unless the destination is
  git-ignored (override: `ALLOW_BACKUP_IN_REPO=1`). Backups with TC kimlik
  numbers must not be one `git add .` away from a commit.
- Archives are `0600`, the destination directory `0700`.

### Configuration

Every knob is a flag or an env var (flag wins).

| Flag | Env | Default | Notes |
|---|---|---|---|
| `--dest` | `BACKUP_DIR` | `$HOME/garajim-backups` | must be outside the repo, or git-ignored |
| `--data-dir` | `DATA_DIR` | `./data` | sets `--db` and `--uploads` together |
| `--db` | `DB_PATH` | `$DATA_DIR/app.db` | |
| `--uploads` | `UPLOADS_DIR` | `$DATA_DIR/uploads` | falls back to `docker cp` from the container if absent on the host |
| `--container` | `CONTAINER` | `mototracker-api` | |
| `--method` | `METHOD` | `auto` | `auto` → container if running, else host `sqlite3` |
| `--retention-days` | `RETENTION_DAYS` | `30` | archives older than this are pruned |
| `--keep-min` | `KEEP_MIN` | `7` | floor — pruning never drops below this many |
| `--no-prune` | `PRUNE=0` | prune on | |

Retention keeps the newest `--keep-min` archives no matter how old they are, so
a month of silently failing cron runs still leaves you something to restore.

### Scheduling

```cron
# Daily at 04:30. Non-zero exit → cron emails you → you find out the same day.
30 4 * * * BACKUP_DIR=/srv/backups/garajim /srv/mototracker/scripts/backup.sh >> /var/log/garajim-backup.log 2>&1
```

Roughly 6-7 MB per run at current data volume (the uploads dominate; the
database compresses to a few hundred KB), so 30 daily archives ≈ 200 MB.

### Getting a copy off the box

Deliberately **not** wired up. There is no cloud SDK and no credential on the
app host by default; the tail of `scripts/backup.sh` carries two commented
patterns instead:

- `rsync` over SSH to a machine you own, or
- better, a **pull** from that machine, so the app host holds no outbound
  credentials at all.

If the destination is not fully trusted, encrypt first (`age -r age1... archive
> archive.age`). Whatever you choose: the archive contains identity documents.
Treat any copy of it accordingly.

### Verifying a backup

Cheap, and worth doing occasionally — an unverified backup is a rumour:

```bash
cd ~/garajim-backups
shasum -a 256 -c garajim-backup-20260817T192500Z.tar.gz.sha256
mkdir -p /tmp/drill && tar -xzf garajim-backup-20260817T192500Z.tar.gz -C /tmp/drill
sqlite3 /tmp/drill/app.db "PRAGMA integrity_check; SELECT count(*) FROM user;"
```

Better still, a real restore drill into a scratch directory — it touches nothing
live:

```bash
./scripts/restore.sh <archive> --data-dir /tmp/restore-drill \
  --container none --yes --no-restart
```

---

## Restore

```bash
./scripts/restore.sh ~/garajim-backups/garajim-backup-20260817T192500Z.tar.gz
```

The script performs, announcing each step and stopping at the first failure:

1. **Verify** — sha256 against the sidecar, `tar` readback, `app.db` present at
   the archive root, `PRAGMA integrity_check`. A damaged archive is rejected
   *before* anything live is touched.
2. **Confirm** — you type `restore`. Non-interactive callers must pass `--yes`.
3. **Stop the api** — `docker compose stop api`. Nothing may hold the database
   open while it is replaced.
4. **Park the current state** — `data/app.db`, `data/app.db-wal`,
   `data/app.db-shm` and `data/uploads/` are *moved* (not deleted) into
   `data/.pre-restore-<stamp>/`. Restoring the wrong archive is recoverable.
5. **Extract** — `app.db` and `uploads/` into `./data`, then explicitly remove
   any `app.db-wal` / `app.db-shm`. **This step is the one that matters:** a
   leftover WAL from the old database sitting next to a restored `app.db` is
   read as *that* database's journal, and will corrupt it.
6. **Fix ownership** — the runtime image declares no `USER`, so the api runs as
   root and the bind mount must be root-writable (`chown -R 0:0`, override with
   `--owner`). Skipped on macOS, where Docker Desktop virtualizes bind-mount
   ownership.
7. **Start and check** — `docker compose up -d api`, then poll
   `http://127.0.0.1:8787/api/health` for up to 30 s.

Useful flags: `--data-dir` (restore somewhere else — drills), `--container`,
`--no-restart`, `--yes`.

### By hand

If the script is unavailable, this is the whole procedure:

```bash
cd /srv/mototracker
ARCHIVE=~/garajim-backups/garajim-backup-20260817T192500Z.tar.gz

shasum -a 256 -c "$ARCHIVE.sha256"       # 1. verify before touching anything
docker compose stop api                  # 2. stop the writer

mkdir -p data/.pre-restore                # 3. park the current state
mv data/app.db data/app.db-wal data/app.db-shm data/uploads data/.pre-restore/ 2>/dev/null

tar -xzf "$ARCHIVE" -C data app.db uploads   # 4. restore
rm -f data/app.db-wal data/app.db-shm        # 5. no stale journal, ever

chown -R 0:0 data/app.db data/uploads    # 6. Linux hosts only
chmod 600 data/app.db

docker compose up -d api                 # 7. back up
curl -fsS http://127.0.0.1:8787/api/health && echo
```

Delete `data/.pre-restore*` once you are satisfied — it is a full second copy of
the data, sensitive and space-consuming.

---

## When the app is unhealthy

Work down this list; it is ordered by how often each one is the answer.

**1. Is the API answering at all?**

```bash
curl -fsS http://127.0.0.1:8787/api/health   # → {"ok":true,"service":"mototracker-api",...}
docker compose ps                            # api should be Up, not Restarting
docker compose logs --tail=100 api
```

A container stuck in `Restarting` is almost always a startup crash: a missing
`APP_BASE_URL` / `SESSION_SECRET` in `.env`, or a migration that threw. The logs
say which, in the first 20 lines.

**2. The API is healthy but the phone can't reach it.**
Then it is the tunnel, not the app. The API binds `127.0.0.1:8787` on purpose —
there is no public path that bypasses the tunnel.

```bash
docker compose ps cloudflared            # production tunnel (--profile cloudflare)
docker compose logs --tail=50 cloudflared
```

Check that `APP_BASE_URL` in `.env` still matches the hostname the tunnel serves.
If it doesn't, auth cookies and OAuth redirects break in ways that look like
random sign-in failures.

**3. Disk.** SQLite fails hard and unhelpfully when the filesystem is full, and
uploads plus backups plus `.pre-restore` copies add up.

```bash
df -h .
du -sh data data/uploads ~/garajim-backups
```

**4. A large `app.db-wal`.** Normal — it grows between checkpoints — but a WAL
that keeps growing and never shrinks means something holds a read transaction
open indefinitely. Restarting the api checkpoints it:

```bash
ls -la data/app.db*
docker compose restart api
```

Never delete `app.db-wal` on a live database. That *is* your recent data.

**5. `SQLITE_BUSY` / "database is locked" in the logs.** Two writers.
`busy_timeout` is 5 s, so this usually means a stray `pnpm dev:api` on the host
is pointed at the same `data/app.db` as the container, or a `sqlite3` shell was
left open on it. Only one process should ever write `./data/app.db`.

**6. Uploads fail / OCR never starts.** Check permissions on the bind mount —
the container runs as root, so files created by a host-side restore under your
own uid can be unreadable to it:

```bash
ls -la data/uploads | head
docker compose exec api sh -c 'touch /data/uploads/.wtest && rm /data/uploads/.wtest && echo writable'
```

**7. OCR stalls or errors.** That subsystem is external to the app: the Ollama
model (host or bundled) and Tesseract in the image. `README.md`'s
troubleshooting section covers the model-not-found and unparseable-response
cases.

**8. Reminders didn't go out.** The dispatcher is a `node-cron` job in the api
process — if the container restarted after `CRON_HOUR` (default 09:00
`Europe/Istanbul`), that day's run is simply missed; `notification_sent`
de-dupes so it will not double-send later. Confirm with
`docker compose logs api | grep -i cron`.

**Before you try anything invasive** — a schema fix, a manual `UPDATE`, a
downgrade — take a backup first. It takes about a second:

```bash
./scripts/backup.sh
```
