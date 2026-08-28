#!/usr/bin/env node
/**
 * ============================================================================
 * fleet-admin — operator CLI for Garajım fleet organizations.
 * ============================================================================
 *
 * Fleet is invisible to consumers by deliberate App Store design (see
 * docs/fleet-design.md §1): there is no sign-up, no pricing page, no
 * contact-sales button. An organization therefore comes into existence in
 * exactly one way — an operator runs this script after a contract is signed.
 * That makes this file the whole provisioning surface, and the runbook that
 * wraps it is docs/fleet-operations.md.
 *
 * It talks to the SQLite database directly rather than through the API, because
 * there is no privileged HTTP route to talk to and there must not be one: an
 * endpoint that creates organizations is an endpoint an attacker can find.
 *
 * Usage:
 *   node scripts/fleet-admin.mjs <command> [options]
 *   node scripts/fleet-admin.mjs help
 *
 * Commands:
 *   org:create    --name <name> --mode rental|fleet [--max-vehicles N]
 *   org:list      [--json]
 *   org:show      --org <id|name>
 *   org:ceiling   --org <id|name> --max-vehicles N
 *   member:add    --org <id|name> --email <email> --role <role>
 *   member:list   --org <id|name>
 *   member:remove --org <id|name> --email <email> --yes
 *   invite:list   --org <id|name>
 *   invite:revoke --org <id|name> --email <email>
 *   org:delete    --org <id|name> --confirm "<exact org name>"     [DESTRUCTIVE]
 *
 * Global options:
 *   --db <path>       SQLite file. Default: $DATABASE_PATH, else <repo>/data/app.db
 *   --uploads <dir>   Uploads root. Default: $UPLOADS_DIR, else <repo>/data/uploads
 *   --migrate         Apply any pending migrations to --db before running
 *   --json            Machine-readable output where the command supports it
 *
 * Production (the api container runs as the unprivileged `node` user and the
 * image does not ship scripts/, so copy them in first):
 *
 *   docker cp scripts mototracker-api:/app/scripts
 *   docker exec -u node mototracker-api node /app/scripts/fleet-admin.mjs org:list
 *
 * Exit status is 0 only on success; every failure path exits non-zero so this is
 * safe to put behind `set -e` or a cron job.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repo root in a checkout; `/app` inside the runtime image. */
export const ROOT = path.resolve(__dirname, "..");

// ─── pretty output (mirrors scripts/bootstrap.sh) ────────────────────────────

const tty = process.stdout.isTTY;
const c = tty
  ? { bold: "\x1b[1m", dim: "\x1b[2m", reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m" }
  : { bold: "", dim: "", reset: "", green: "", yellow: "", red: "", cyan: "" };

export const say = (...m) => console.log(`${c.cyan}» ${m.join(" ")}${c.reset}`);
export const ok = (...m) => console.log(`${c.green}✓ ${m.join(" ")}${c.reset}`);
export const warn = (...m) => console.log(`${c.yellow}! ${m.join(" ")}${c.reset}`);

/** Every refusal in this file throws this, so the CLI can print it without a stack. */
export class OperatorError extends Error {}
const bail = (msg) => {
  throw new OperatorError(msg);
};

// ─── dependency + path resolution ────────────────────────────────────────────

/**
 * `require` bound to wherever the api's node_modules actually is.
 *
 * pnpm does not hoist, so `better-sqlite3` lives in apps/api/node_modules in a
 * checkout and in /app/node_modules in the image — neither of which a bare
 * `import` from scripts/ would find, because ESM resolves relative to the
 * importing FILE, not the cwd.
 */
let _require = null;
export function apiRequire() {
  if (_require) return _require;
  const bases = [path.join(ROOT, "apps", "api"), ROOT, __dirname];
  for (const base of bases) {
    try {
      const r = createRequire(pathToFileURL(path.join(base, "package.json")).href);
      r.resolve("better-sqlite3");
      _require = r;
      return r;
    } catch {
      /* try the next base */
    }
  }
  bail(
    "Could not resolve better-sqlite3. Run `pnpm install` in the repo, or run this\n" +
      "  inside the api container (see the header of this file).",
  );
}

/** Where the migrations live: source tree in a checkout, dist/ in the image. */
export function migrationsDir() {
  const candidates = [
    path.join(ROOT, "apps", "api", "src", "db", "migrations"),
    // The image: the Dockerfile copies them to dist/, which is what migrate.ts
    // reads at boot; src/ also survives `pnpm deploy` and is the last resort.
    path.join(ROOT, "dist", "db", "migrations"),
    path.join(ROOT, "src", "db", "migrations"),
  ];
  return candidates.find((d) => fs.existsSync(d)) ?? null;
}

export function resolveDbPath(opts = {}) {
  return opts.db ?? process.env.DATABASE_PATH ?? path.join(ROOT, "data", "app.db");
}

export function resolveUploadsDir(opts = {}) {
  return opts.uploads ?? process.env.UPLOADS_DIR ?? path.join(ROOT, "data", "uploads");
}

/** Open the database with exactly the pragmas the app uses (db/index.ts). */
export function openDb(dbPath) {
  const Database = apiRequire()("better-sqlite3");
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // Load-bearing, not cosmetic: org deletion relies on the ON DELETE CASCADE
  // chain in 021_organization.sql, which SQLite ignores when this is off.
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/**
 * Apply pending migrations, same algorithm and same `_migrations` ledger as
 * apps/api/src/db/migrate.ts — so a scratch database created here is byte-wise
 * the schema the app expects, and re-running against a live database is a no-op.
 */
export function ensureSchema(db) {
  const dir = migrationsDir();
  if (!dir) bail("Could not find the migrations directory next to this script.");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
  );
  const applied = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations(name) VALUES (?)").run(file);
    })();
    applied.push(file);
  }
  return applied;
}

/** Fail early and legibly rather than with `no such table: organization`. */
export function assertSchema(db) {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'organization'")
    .get();
  if (!row) {
    bail(
      "This database has no `organization` table — migrations have not run.\n" +
        "  Start the api once, or re-run this command with --migrate.",
    );
  }
}

export function newId() {
  return apiRequire()("ulid").ulid();
}

// ─── operations (exported: the demo seeder and the tests reuse these) ────────

export const ORG_MODES = ["rental", "fleet"];
export const ORG_ROLES = ["owner", "manager", "staff", "driver"];

export function createOrganization(db, { id, name, mode, maxVehicles = 1 }) {
  if (!name || !name.trim()) bail("--name is required.");
  if (!ORG_MODES.includes(mode)) bail(`--mode must be one of: ${ORG_MODES.join(", ")}`);
  if (!Number.isInteger(maxVehicles) || maxVehicles < 0) bail("--max-vehicles must be a non-negative integer.");
  const orgId = id ?? newId();
  db.prepare("INSERT INTO organization (id, name, mode, max_vehicles) VALUES (?, ?, ?, ?)").run(
    orgId,
    name.trim(),
    mode,
    maxVehicles,
  );
  return orgId;
}

/**
 * Raise (or lower) an org's active-vehicle ceiling — what you run when a
 * customer pays an invoice.
 *
 * This mirrors `setOrgMaxVehicles` in apps/api/src/lib/entitlement.ts, which is
 * the app's single write seam for the ceiling. tests/fleetAdmin.test.ts asserts
 * the two produce identical rows, so the copy cannot quietly drift.
 */
export function setOrgCeiling(db, orgId, maxVehicles) {
  if (!Number.isInteger(maxVehicles) || maxVehicles < 0) bail("--max-vehicles must be a non-negative integer.");
  const res = db
    .prepare("UPDATE organization SET max_vehicles = ?, updated_at = datetime('now') WHERE id = ?")
    .run(maxVehicles, orgId);
  if (res.changes === 0) bail(`No organization with id ${orgId}.`);
  return maxVehicles;
}

/** Resolve `--org` as an id first, then as an exact name (must be unambiguous). */
export function findOrg(db, ref) {
  if (!ref) bail("--org is required (organization id or exact name).");
  const byId = db.prepare("SELECT * FROM organization WHERE id = ?").get(ref);
  if (byId) return byId;
  const byName = db.prepare("SELECT * FROM organization WHERE name = ?").all(ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) bail(`"${ref}" matches ${byName.length} organizations — use the id.`);
  bail(`No organization matching "${ref}".`);
}

export function listOrganizations(db) {
  return db
    .prepare(
      `SELECT o.id,
              o.name,
              o.mode,
              o.max_vehicles,
              o.created_at,
              (SELECT COUNT(*) FROM org_member m WHERE m.org_id = o.id AND m.status = 'active') AS members,
              (SELECT COUNT(*) FROM bike b WHERE b.org_id = o.id AND b.archived = 0) AS vehicles,
              (SELECT COUNT(*) FROM org_invite i WHERE i.org_id = o.id AND i.accepted_at IS NULL
                 AND i.expires_at > datetime('now')) AS pending_invites
         FROM organization o
        ORDER BY o.created_at ASC`,
    )
    .all();
}

export function findUserByEmail(db, email) {
  return db.prepare("SELECT id, email, name FROM user WHERE lower(email) = lower(?)").get(email) ?? null;
}

/**
 * Grant (or change) a membership. Deliberately an upsert: promoting the
 * customer's existing manager to owner is the same command as adding them, and
 * it also un-does a previous `member:remove` by flipping status back to active.
 */
export function upsertMember(db, orgId, userId, role) {
  if (!ORG_ROLES.includes(role)) bail(`--role must be one of: ${ORG_ROLES.join(", ")}`);
  const before = db
    .prepare("SELECT role, status FROM org_member WHERE org_id = ? AND user_id = ?")
    .get(orgId, userId);
  db.prepare(
    `INSERT INTO org_member (org_id, user_id, role, status) VALUES (?, ?, ?, 'active')
       ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role, status = 'active'`,
  ).run(orgId, userId, role);
  return { previous: before ?? null };
}

/**
 * The email has no account yet.
 *
 * We create an INVITE rather than an account. Creating the account here would
 * mean the operator chooses (and therefore knows) the customer's password,
 * which is a credential we should never possess; the invite hands the capability
 * to the person who owns the mailbox instead. The token is the capability — it
 * is printed once, is single-use, and expires.
 */
export function createInvite(db, { orgId, email, role, ttlDays = 14, invitedBy = null }) {
  if (!ORG_ROLES.includes(role)) bail(`--role must be one of: ${ORG_ROLES.join(", ")}`);
  if (!email || !email.includes("@")) bail("--email must be an email address.");
  const token = crypto.randomBytes(32).toString("base64url");
  const id = newId();
  const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();
  // One live invite per (org, email): re-inviting replaces the old capability
  // instead of leaving two working links in two inboxes.
  db.prepare(
    "DELETE FROM org_invite WHERE org_id = ? AND lower(email) = lower(?) AND accepted_at IS NULL",
  ).run(orgId, email);
  db.prepare(
    "INSERT INTO org_invite (id, org_id, email, role, token, expires_at, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, orgId, email.trim(), role, token, expiresAt, invitedBy);
  return { id, token, expiresAt };
}

export function listInvites(db, orgId) {
  return db
    .prepare(
      `SELECT id, email, role, expires_at, accepted_at, created_at,
              (accepted_at IS NULL AND expires_at > datetime('now')) AS live
         FROM org_invite WHERE org_id = ? ORDER BY created_at DESC`,
    )
    .all(orgId);
}

export function revokeInvites(db, orgId, email) {
  return db
    .prepare("DELETE FROM org_invite WHERE org_id = ? AND lower(email) = lower(?) AND accepted_at IS NULL")
    .run(orgId, email).changes;
}

export function listMembers(db, orgId) {
  return db
    .prepare(
      `SELECT m.user_id, m.role, m.status, m.joined_at, u.email, u.name,
              (SELECT COUNT(*) FROM vehicle_assignment va
                WHERE va.org_id = m.org_id AND va.user_id = m.user_id AND va.ended_at IS NULL) AS holding
         FROM org_member m JOIN user u ON u.id = m.user_id
        WHERE m.org_id = ?
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
                 m.joined_at ASC`,
    )
    .all(orgId);
}

/**
 * Revoke access. The row is kept with status='removed', not deleted: 021 keeps
 * membership history so "who signed this contract" still resolves to a name,
 * while every access check requires status='active' — so access stops now.
 * Any vehicle still in their hands is handed back at the same time, because a
 * stale open assignment is the one thing that could outlive the membership.
 */
export function removeMember(db, orgId, userId) {
  const tx = db.transaction(() => {
    const res = db
      .prepare("UPDATE org_member SET status = 'removed' WHERE org_id = ? AND user_id = ? AND status = 'active'")
      .run(orgId, userId);
    const closed = db
      .prepare(
        "UPDATE vehicle_assignment SET ended_at = datetime('now') WHERE org_id = ? AND user_id = ? AND ended_at IS NULL",
      )
      .run(orgId, userId);
    return { removed: res.changes > 0, assignmentsClosed: closed.changes };
  });
  return tx();
}

/**
 * Dissolve an organization: the DB row and everything cascading from it, plus
 * the org's uploads on disk.
 *
 * Two things the cascade does NOT do, and this function must:
 *
 *  1. UPLOADS_DIR/org/<orgId> — routes/documents.ts writes org scans there
 *     precisely so a departing member's account deletion cannot take them, and
 *     nothing else ever removes that directory. Left behind, it is ruhsat and
 *     poliçe photos of a customer we no longer have a relationship with.
 *  2. `document` rows for the org's vehicles. document.bike_id is
 *     ON DELETE SET NULL, so dropping the vehicles orphans those rows onto the
 *     members personally — rows whose file_path we are about to delete. They go
 *     first, while they are still identifiable.
 */
export function deleteOrganization(db, orgId, { uploadsDir } = {}) {
  const counts = {
    vehicles: db.prepare("SELECT COUNT(*) n FROM bike WHERE org_id = ?").get(orgId).n,
    members: db.prepare("SELECT COUNT(*) n FROM org_member WHERE org_id = ?").get(orgId).n,
    customers: db.prepare("SELECT COUNT(*) n FROM fleet_customer WHERE org_id = ?").get(orgId).n,
    contracts: db.prepare("SELECT COUNT(*) n FROM rental_contract WHERE org_id = ?").get(orgId).n,
    documents: db
      .prepare("SELECT COUNT(*) n FROM document WHERE bike_id IN (SELECT id FROM bike WHERE org_id = ?)")
      .get(orgId).n,
  };
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM document WHERE bike_id IN (SELECT id FROM bike WHERE org_id = ?)").run(orgId);
    const res = db.prepare("DELETE FROM organization WHERE id = ?").run(orgId);
    if (res.changes === 0) bail(`No organization with id ${orgId}.`);
  });
  tx();

  let uploadsRemoved = null;
  if (uploadsDir) {
    const dir = path.join(uploadsDir, "org", orgId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      uploadsRemoved = dir;
    }
  }
  return { ...counts, uploadsRemoved };
}

// ─── argument parsing ────────────────────────────────────────────────────────

const FLAGS = new Set(["json", "yes", "migrate", "allow-nonempty", "quiet", "wipe", "no-verify", "help"]);

export function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = (eq === -1 ? a.slice(2) : a.slice(2, eq)).trim();
    if (FLAGS.has(key)) {
      opts[camel(key)] = eq === -1 ? true : argv[i].slice(eq + 1) !== "false";
      continue;
    }
    const val = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (val === undefined) bail(`--${key} needs a value.`);
    opts[camel(key)] = val;
  }
  return { opts, rest };
}

const camel = (s) => s.replace(/-([a-z])/g, (_, x) => x.toUpperCase());

export function intOpt(opts, key, { required = false } = {}) {
  const raw = opts[camel(key)];
  if (raw === undefined) {
    if (required) bail(`--${key} is required.`);
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) bail(`--${key} must be an integer (got "${raw}").`);
  return n;
}

async function confirmPrompt(question, expected) {
  if (!process.stdin.isTTY) {
    bail(`Refusing: this is destructive and stdin is not a terminal. Pass --confirm "${expected}".`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(question, res));
  rl.close();
  return answer.trim();
}

// ─── commands ────────────────────────────────────────────────────────────────

function table(rows, cols) {
  if (rows.length === 0) return "  (none)";
  const widths = cols.map((col) =>
    Math.max(col.label.length, ...rows.map((r) => String(col.get(r) ?? "").length)),
  );
  const line = (cells) => "  " + cells.map((s, i) => String(s).padEnd(widths[i])).join("  ");
  return [
    c.bold + line(cols.map((col) => col.label)) + c.reset,
    c.dim + line(widths.map((w) => "─".repeat(w))) + c.reset,
    ...rows.map((r) => line(cols.map((col) => col.get(r) ?? ""))),
  ].join("\n");
}

const COMMANDS = {
  "org:create": async (db, opts) => {
    const orgId = createOrganization(db, {
      name: opts.name,
      mode: opts.mode,
      maxVehicles: intOpt(opts, "max-vehicles") ?? 1,
    });
    const row = db.prepare("SELECT * FROM organization WHERE id = ?").get(orgId);
    if (opts.json) return console.log(JSON.stringify(row, null, 2));
    ok(`Created organization "${row.name}" (${row.mode}), ceiling ${row.max_vehicles} vehicles.`);
    console.log(`  ${c.bold}org id:${c.reset} ${orgId}`);
    console.log(
      `${c.dim}  Next: fleet-admin.mjs member:add --org ${orgId} --email <owner email> --role owner${c.reset}`,
    );
  },

  "org:list": async (db, opts) => {
    const rows = listOrganizations(db);
    if (opts.json) return console.log(JSON.stringify(rows, null, 2));
    console.log(
      table(rows, [
        { label: "ID", get: (r) => r.id },
        { label: "NAME", get: (r) => r.name },
        { label: "MODE", get: (r) => r.mode },
        { label: "MEMBERS", get: (r) => r.members },
        { label: "VEHICLES", get: (r) => `${r.vehicles}/${r.max_vehicles}` },
        { label: "INVITES", get: (r) => r.pending_invites },
        { label: "CREATED", get: (r) => r.created_at.slice(0, 10) },
      ]),
    );
    console.log(`${c.dim}  ${rows.length} organization(s).${c.reset}`);
  },

  "org:show": async (db, opts) => {
    const org = findOrg(db, opts.org);
    const members = listMembers(db, org.id);
    const vehicles = db
      .prepare("SELECT COUNT(*) n FROM bike WHERE org_id = ? AND archived = 0")
      .get(org.id).n;
    const payload = { ...org, vehicles, members };
    if (opts.json) return console.log(JSON.stringify(payload, null, 2));
    console.log(`  ${c.bold}${org.name}${c.reset}  ${c.dim}${org.id}${c.reset}`);
    console.log(`  mode ${org.mode} · vehicles ${vehicles}/${org.max_vehicles} · created ${org.created_at}`);
    console.log(
      table(members, [
        { label: "ROLE", get: (m) => m.role },
        { label: "EMAIL", get: (m) => m.email },
        { label: "NAME", get: (m) => m.name ?? "" },
        { label: "STATUS", get: (m) => m.status },
        { label: "HOLDING", get: (m) => m.holding },
      ]),
    );
  },

  "org:ceiling": async (db, opts) => {
    const org = findOrg(db, opts.org);
    const n = intOpt(opts, "max-vehicles", { required: true });
    const active = db.prepare("SELECT COUNT(*) n FROM bike WHERE org_id = ? AND archived = 0").get(org.id).n;
    setOrgCeiling(db, org.id, n);
    ok(`"${org.name}" ceiling ${org.max_vehicles} → ${n} vehicles.`);
    if (n < active) {
      // Lowering below the current count never deletes anything; it only stops
      // the org adding more. Say so, so nobody goes looking for missing vans.
      warn(`${active} vehicles are already active — none were removed, but no more can be added.`);
    }
  },

  "member:add": async (db, opts) => {
    const org = findOrg(db, opts.org);
    const role = opts.role;
    if (!opts.email) bail("--email is required.");
    const user = findUserByEmail(db, opts.email);
    if (user) {
      const { previous } = upsertMember(db, org.id, user.id, role);
      if (previous && previous.role === role && previous.status === "active") {
        ok(`${user.email} is already ${role} of "${org.name}" — nothing to do.`);
      } else if (previous) {
        ok(`${user.email}: ${previous.role}/${previous.status} → ${role}/active in "${org.name}".`);
      } else {
        ok(`Added ${user.email} to "${org.name}" as ${role}.`);
      }
      return;
    }
    const invite = createInvite(db, { orgId: org.id, email: opts.email, role });
    const base = process.env.APP_BASE_URL ?? "https://<your app base url>";
    ok(`No account for ${opts.email} yet — created an invite (${role}) for "${org.name}".`);
    console.log(`  ${c.bold}invite link:${c.reset} ${base}/invite/${invite.token}`);
    console.log(`  ${c.dim}expires ${invite.expiresAt} · single use · anyone holding this link can join${c.reset}`);
    console.log(
      `${c.dim}  Send it to ${opts.email}. They sign up (or sign in) and land in the org.${c.reset}`,
    );
  },

  "member:list": async (db, opts) => {
    const org = findOrg(db, opts.org);
    const members = listMembers(db, org.id);
    if (opts.json) return console.log(JSON.stringify(members, null, 2));
    console.log(
      table(members, [
        { label: "ROLE", get: (m) => m.role },
        { label: "EMAIL", get: (m) => m.email },
        { label: "NAME", get: (m) => m.name ?? "" },
        { label: "STATUS", get: (m) => m.status },
        { label: "JOINED", get: (m) => m.joined_at.slice(0, 10) },
        { label: "HOLDING", get: (m) => m.holding },
      ]),
    );
  },

  "member:remove": async (db, opts) => {
    const org = findOrg(db, opts.org);
    if (!opts.email) bail("--email is required.");
    const user = findUserByEmail(db, opts.email);
    if (!user) bail(`No account for ${opts.email}.`);
    const owners = db
      .prepare("SELECT COUNT(*) n FROM org_member WHERE org_id = ? AND role = 'owner' AND status = 'active'")
      .get(org.id).n;
    const isOwner = db
      .prepare("SELECT role FROM org_member WHERE org_id = ? AND user_id = ? AND status = 'active'")
      .get(org.id, user.id)?.role === "owner";
    if (isOwner && owners <= 1) {
      bail(
        `${user.email} is the only owner of "${org.name}". Promote someone else first:\n` +
          `  fleet-admin.mjs member:add --org ${org.id} --email <other> --role owner`,
      );
    }
    if (!opts.yes) {
      const answer = await confirmPrompt(`Remove ${user.email} from "${org.name}"? type yes: `, "yes");
      if (answer !== "yes") bail("Aborted.");
    }
    const res = removeMember(db, org.id, user.id);
    if (!res.removed) bail(`${user.email} is not an active member of "${org.name}".`);
    ok(
      `Revoked ${user.email} from "${org.name}"` +
        (res.assignmentsClosed ? ` and closed ${res.assignmentsClosed} open assignment(s).` : "."),
    );
    console.log(`${c.dim}  History is kept (status='removed'); access stopped immediately.${c.reset}`);
  },

  "invite:list": async (db, opts) => {
    const org = findOrg(db, opts.org);
    const rows = listInvites(db, org.id);
    if (opts.json) return console.log(JSON.stringify(rows, null, 2));
    console.log(
      table(rows, [
        { label: "EMAIL", get: (r) => r.email },
        { label: "ROLE", get: (r) => r.role },
        { label: "STATE", get: (r) => (r.accepted_at ? "accepted" : r.live ? "pending" : "expired") },
        { label: "EXPIRES", get: (r) => r.expires_at.slice(0, 10) },
      ]),
    );
    // Tokens are capabilities: they are printed once, at creation, and never again.
    console.log(`${c.dim}  Tokens are never listed. Re-run member:add to issue a fresh link.${c.reset}`);
  },

  "invite:revoke": async (db, opts) => {
    const org = findOrg(db, opts.org);
    if (!opts.email) bail("--email is required.");
    const n = revokeInvites(db, org.id, opts.email);
    ok(`Revoked ${n} pending invite(s) for ${opts.email} in "${org.name}".`);
  },

  "org:delete": async (db, opts) => {
    const org = findOrg(db, opts.org);
    const uploadsDir = resolveUploadsDir(opts);
    const preview = {
      vehicles: db.prepare("SELECT COUNT(*) n FROM bike WHERE org_id = ?").get(org.id).n,
      members: db.prepare("SELECT COUNT(*) n FROM org_member WHERE org_id = ?").get(org.id).n,
      customers: db.prepare("SELECT COUNT(*) n FROM fleet_customer WHERE org_id = ?").get(org.id).n,
    };
    warn(
      `About to DELETE "${org.name}" — ${preview.vehicles} vehicles, ${preview.members} memberships, ` +
        `${preview.customers} customers, all contracts, documents and history.`,
    );
    console.log(`  ${c.dim}and ${path.join(uploadsDir, "org", org.id)} from disk.${c.reset}`);
    const confirm = opts.confirm ?? (await confirmPrompt(`Type the organization name to confirm: `, org.name));
    if (confirm !== org.name) bail(`Confirmation "${confirm}" does not match "${org.name}". Nothing was deleted.`);
    const res = deleteOrganization(db, org.id, { uploadsDir });
    ok(`Deleted "${org.name}".`);
    console.log(
      `  vehicles ${res.vehicles} · members ${res.members} · customers ${res.customers} · ` +
        `contracts ${res.contracts} · documents ${res.documents}`,
    );
    console.log(`  uploads: ${res.uploadsRemoved ?? "(no org upload directory on disk)"}`);
  },

  help: async () => usage(),
};

function usage() {
  const header = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0];
  console.log(
    header
      .split("\n")
      .filter((l) => l !== "#!/usr/bin/env node" && l !== "/**")
      .map((l) => l.replace(/^ \* ?/, "").replace(/^ \*$/, ""))
      .join("\n"),
  );
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2)) {
  const { opts, rest } = parseArgs(argv);
  const cmd = rest[0];
  if (!cmd || cmd === "help" || opts.help) return usage();
  const fn = COMMANDS[cmd];
  if (!fn) bail(`Unknown command "${cmd}". Run \`fleet-admin.mjs help\`.`);

  const dbPath = resolveDbPath(opts);
  const db = openDb(dbPath);
  try {
    if (opts.migrate) {
      const applied = ensureSchema(db);
      if (applied.length) say(`Applied ${applied.length} migration(s) to ${dbPath}.`);
    }
    assertSchema(db);
    if (!opts.json && !opts.quiet) console.log(`${c.dim}db: ${dbPath}${c.reset}`);
    await fn(db, opts);
  } finally {
    db.close();
  }
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    if (err instanceof OperatorError) console.error(`${c.red}✗ ${err.message}${c.reset}`);
    else console.error(`${c.red}✗ ${err?.stack ?? err}${c.reset}`);
    process.exitCode = 1;
  });
}
