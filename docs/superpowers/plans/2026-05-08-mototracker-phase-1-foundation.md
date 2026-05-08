# MotoTracker — Phase 1: Foundation + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, the self-hostable API (Express + SQLite + BetterAuth), the React PWA shell with auth screens, and bikes CRUD. End state: a user can sign up, sign in (email/password, magic link, Google), add/edit/archive bikes, and see them.

**Architecture:** pnpm workspaces with `apps/web` (React PWA → Vercel) and `apps/api` (Express + better-sqlite3 + BetterAuth → self-hosted via Docker). All persistence in a single SQLite file. Multi-user with auth middleware that enforces `user_id` on every query.

**Tech Stack:** Node 20, TypeScript 5, Express 4, better-sqlite3, BetterAuth, Vite 5, React 18, Tailwind CSS v4, shadcn/ui, react-router 6, TanStack Query 5, react-hook-form, zod, vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-05-08-mototracker-design.md`

---

## File Structure (created by this plan)

```
mototracker/
  .gitignore
  .editorconfig
  .nvmrc
  package.json                     # root, pnpm workspaces
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
  docker-compose.yml
  .env.example
  packages/
    shared/
      package.json
      src/
        index.ts
        schemas/
          bike.ts                  # zod schemas shared web<->api
          auth.ts
      tsconfig.json
  apps/
    api/
      package.json
      tsconfig.json
      vitest.config.ts
      Dockerfile
      .env.example
      src/
        server.ts                  # express bootstrap
        config.ts                  # zod-validated env
        db/
          index.ts                 # better-sqlite3 connection + helpers
          migrate.ts               # migrations runner
          migrations/
            001_init.sql           # betterauth + app tables
        auth/
          index.ts                 # BetterAuth config + handler mount
          email.ts                 # Resend transport for magic links
        middleware/
          requireUser.ts           # injects req.user from BetterAuth session
          errorHandler.ts          # central error formatter
        routes/
          health.ts
          me.ts
          bikes.ts
        lib/
          ulid.ts
          asyncHandler.ts
        types/
          express.d.ts             # augment Request with user
        index.ts                   # entrypoint
      tests/
        helpers/
          buildApp.ts              # spins up app with in-memory sqlite
          authedRequest.ts
        bikes.test.ts
        auth.test.ts
    web/
      package.json
      tsconfig.json
      tsconfig.node.json
      vite.config.ts
      vercel.json
      tailwind.config.ts
      postcss.config.cjs
      index.html
      public/
        favicon.svg
      src/
        main.tsx
        App.tsx
        env.ts
        lib/
          api.ts                   # fetch wrapper
          authClient.ts            # BetterAuth client
          queryClient.ts
          cn.ts                    # tailwind classnames helper
        components/
          ui/                      # shadcn primitives (button, input, card, ...)
          AppShell.tsx
          BrandMark.tsx
        pages/
          SignInPage.tsx
          SignUpPage.tsx
          MagicLinkSentPage.tsx
          AuthCallbackPage.tsx
          BikesPage.tsx
          BikeFormPage.tsx
          NotFoundPage.tsx
        hooks/
          useMe.ts
          useBikes.ts
        routes.tsx                 # router config
        styles.css
```

---

## Task 1: Initialize monorepo and tooling

**Files:**
- Create: `mototracker/.gitignore`
- Create: `mototracker/.editorconfig`
- Create: `mototracker/.nvmrc`
- Create: `mototracker/package.json`
- Create: `mototracker/pnpm-workspace.yaml`
- Create: `mototracker/tsconfig.base.json`
- Create: `mototracker/README.md`

- [ ] **Step 1: Initialize git**

```bash
cd /Users/mehditerzi/WebstormProjects/mototracker
git init -b main
```

- [ ] **Step 2: Write .gitignore**

```gitignore
node_modules
dist
build
.env
.env.local
*.log
.DS_Store
.vite
coverage
data/
uploads/
*.db
*.db-journal
*.db-wal
*.db-shm
.vercel
.turbo
.idea
.vscode
```

- [ ] **Step 3: Write .editorconfig**

```ini
root = true

[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```

- [ ] **Step 4: Write .nvmrc**

```
20
```

- [ ] **Step 5: Write pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 6: Write root package.json**

```json
{
  "name": "mototracker",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r --parallel run build",
    "dev:api": "pnpm --filter @mototracker/api dev",
    "dev:web": "pnpm --filter @mototracker/web dev",
    "test": "pnpm -r run test",
    "lint": "pnpm -r run lint"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 7: Write tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": false,
    "types": []
  }
}
```

- [ ] **Step 8: Write README.md (placeholder, expanded later)**

```markdown
# MotoTracker

Self-hosted PWA that tracks motorcycle Sigorta / Kasko / Muayene expiry dates with photo-based OCR and Web Push reminders.

See `docs/superpowers/specs/2026-05-08-mototracker-design.md` for the full spec.

## Quickstart (development)

```bash
pnpm install
pnpm dev:api    # http://localhost:8787
pnpm dev:web    # http://localhost:5173
```
```

- [ ] **Step 9: Install pnpm if missing and commit**

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install
git add -A
git commit -m "chore: initialize monorepo with pnpm workspaces"
```

---

## Task 2: shared package (zod schemas + types)

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/schemas/auth.ts`
- Create: `packages/shared/src/schemas/bike.ts`

- [ ] **Step 1: Write packages/shared/package.json**

```json
{
  "name": "@mototracker/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "echo 'no tests'"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Write packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write packages/shared/src/schemas/bike.ts**

```ts
import { z } from "zod";

export const bikeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  nickname: z.string().min(1).max(80),
  plate: z.string().max(20).nullable(),
  make: z.string().max(60).nullable(),
  model: z.string().max(60).nullable(),
  year: z.number().int().min(1900).max(2100).nullable(),
  currentKm: z.number().int().min(0).nullable(),
  color: z.string().max(40).nullable(),
  photoUrl: z.string().url().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Bike = z.infer<typeof bikeSchema>;

export const bikeCreateSchema = bikeSchema
  .pick({
    nickname: true,
    plate: true,
    make: true,
    model: true,
    year: true,
    currentKm: true,
    color: true,
  })
  .partial({ plate: true, make: true, model: true, year: true, currentKm: true, color: true });
export type BikeCreateInput = z.infer<typeof bikeCreateSchema>;

export const bikeUpdateSchema = bikeCreateSchema.partial();
export type BikeUpdateInput = z.infer<typeof bikeUpdateSchema>;
```

- [ ] **Step 4: Write packages/shared/src/schemas/auth.ts**

```ts
import { z } from "zod";

export const profileSchema = z.object({
  userId: z.string(),
  language: z.enum(["tr", "en"]),
  timezone: z.string(),
  createdAt: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string().nullable(),
    image: z.string().url().nullable(),
  }),
  profile: profileSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
```

- [ ] **Step 5: Write packages/shared/src/index.ts**

```ts
export * from "./schemas/bike";
export * from "./schemas/auth";
```

- [ ] **Step 6: Install and verify typecheck**

```bash
cd /Users/mehditerzi/WebstormProjects/mototracker
pnpm install
pnpm --filter @mototracker/shared run build
```
Expected: no output (typecheck passes).

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add zod schemas for bike and auth"
```

---

## Task 3: API package skeleton (deps, tsconfig, vitest)

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/.env.example`

- [ ] **Step 1: Write apps/api/package.json**

```json
{
  "name": "@mototracker/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "migrate": "tsx src/db/migrate.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mototracker/shared": "workspace:*",
    "better-auth": "^1.0.21",
    "better-sqlite3": "^11.3.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "helmet": "^8.0.0",
    "morgan": "^1.10.0",
    "resend": "^4.0.1",
    "ulid": "^2.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/morgan": "^1.9.9",
    "@types/node": "^22.7.4",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 2: Write apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Write apps/api/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    pool: "forks",
  },
});
```

- [ ] **Step 4: Write apps/api/.env.example**

```env
PORT=8787
NODE_ENV=development
DATABASE_PATH=./data/app.db
WEB_ORIGIN=http://localhost:5173
SESSION_SECRET=replace-me-with-32-chars-of-random
RESEND_API_KEY=
EMAIL_FROM="MotoTracker <noreply@example.com>"
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APP_BASE_URL=http://localhost:8787
```

- [ ] **Step 5: Install and verify**

```bash
pnpm install
pnpm --filter @mototracker/api exec tsc --noEmit
```
Expected: no errors (no source files yet, so tsc has nothing to complain about).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "chore(api): scaffold package, deps, tsconfig, vitest"
```

---

## Task 4: API config + entrypoint scaffolding

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/lib/asyncHandler.ts`
- Create: `apps/api/src/lib/ulid.ts`
- Create: `apps/api/src/types/express.d.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/middleware/errorHandler.ts`
- Create: `apps/api/src/routes/health.ts`

- [ ] **Step 1: Write apps/api/src/config.ts**

```ts
import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().default("./data/app.db"),
  WEB_ORIGIN: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  APP_BASE_URL: z.string().url(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("MotoTracker <noreply@example.com>"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type AppEnv = z.infer<typeof Env>;

export function loadConfig(env = process.env): AppEnv {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    console.error("Invalid environment:\n" + parsed.error.toString());
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const config: AppEnv =
  process.env.NODE_ENV === "test"
    ? loadConfig({
        NODE_ENV: "test",
        WEB_ORIGIN: "http://localhost:5173",
        SESSION_SECRET: "test-secret-test-secret-test-secret",
        APP_BASE_URL: "http://localhost:8787",
        DATABASE_PATH: ":memory:",
      })
    : loadConfig();
```

- [ ] **Step 2: Write apps/api/src/lib/asyncHandler.ts**

```ts
import type { NextFunction, Request, Response, RequestHandler } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

- [ ] **Step 3: Write apps/api/src/lib/ulid.ts**

```ts
import { ulid } from "ulid";
export const newId = () => ulid();
```

- [ ] **Step 4: Write apps/api/src/types/express.d.ts**

```ts
import "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string | null;
      };
    }
  }
}
```

- [ ] **Step 5: Write apps/api/src/middleware/errorHandler.ts**

```ts
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation_error", issues: err.issues });
    return;
  }
  if (err && typeof err === "object" && "status" in err && typeof err.status === "number") {
    res.status(err.status).json({ error: err.message ?? "error" });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
};
```

- [ ] **Step 6: Write apps/api/src/routes/health.ts**

```ts
import { Router } from "express";

export const healthRouter: Router = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ ok: true, service: "mototracker-api", time: new Date().toISOString() });
});
```

- [ ] **Step 7: Write apps/api/src/server.ts**

```ts
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { errorHandler } from "./middleware/errorHandler.js";

export interface BuildAppOptions {
  /** When true, skip request logging and CORS preflight noise (used in tests). */
  silent?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
    }),
  );
  if (!opts.silent && config.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  // BetterAuth handler will be mounted in Task 7 at /api/auth/*
  // before express.json() because it consumes raw bodies for some routes.

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 8: Write apps/api/src/index.ts**

```ts
import { buildApp } from "./server.js";
import { config } from "./config.js";

const app = buildApp();
app.listen(config.PORT, () => {
  console.log(`[api] listening on http://localhost:${config.PORT}`);
});
```

- [ ] **Step 9: Verify dev server starts**

```bash
mkdir -p apps/api/data
cp apps/api/.env.example apps/api/.env
# edit SESSION_SECRET to be at least 16 chars (already long enough in example)
pnpm --filter @mototracker/api dev &
sleep 2
curl -s http://localhost:8787/api/health
kill %1
```
Expected: JSON `{ "ok": true, "service": "mototracker-api", ... }`.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): express bootstrap with health route, config, error handler"
```

---

## Task 5: SQLite + migrations runner

**Files:**
- Create: `apps/api/src/db/index.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/db/migrations/001_init.sql`
- Create: `apps/api/tests/helpers/buildApp.ts`
- Create: `apps/api/tests/db.test.ts`

- [ ] **Step 1: Write apps/api/src/db/index.ts**

```ts
import Database, { type Database as DB } from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  const p = config.DATABASE_PATH;
  if (p !== ":memory:") {
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDbForTests(newPath = ":memory:"): DB {
  closeDb();
  // overwrite config path at runtime for tests
  (config as { DATABASE_PATH: string }).DATABASE_PATH = newPath;
  return getDb();
}
```

- [ ] **Step 2: Write apps/api/src/db/migrations/001_init.sql**

```sql
-- ===== BetterAuth core tables =====
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  image TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(userId);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_account_user ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_verification_id ON verification(identifier);

-- ===== App tables =====
CREATE TABLE IF NOT EXISTS profile (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'tr' CHECK (language IN ('tr','en')),
  timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bike (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  plate TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  current_km INTEGER,
  color TEXT,
  photo_url TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bike_user ON bike(user_id, archived);

-- migrations metadata
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 3: Write apps/api/src/db/migrate.ts**

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");

export function runMigrations(): { applied: string[]; skipped: string[] } {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const exists = db
      .prepare("SELECT 1 FROM _migrations WHERE name = ?")
      .get(file);
    if (exists) {
      skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations(name) VALUES (?)").run(file);
    });
    tx();
    applied.push(file);
  }
  return { applied, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { applied, skipped } = runMigrations();
  console.log(`[migrate] applied: ${applied.length}, skipped: ${skipped.length}`);
  if (applied.length) console.log(applied.map((m) => "  + " + m).join("\n"));
}
```

- [ ] **Step 4: Write apps/api/tests/helpers/buildApp.ts**

```ts
import { buildApp } from "../../src/server.js";
import { resetDbForTests } from "../../src/db/index.js";
import { runMigrations } from "../../src/db/migrate.js";

export function buildTestApp() {
  resetDbForTests(":memory:");
  runMigrations();
  return buildApp({ silent: true });
}
```

- [ ] **Step 5: Write apps/api/tests/db.test.ts (failing test first)**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

describe("migrations", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
  });

  it("creates user, bike, and profile tables", () => {
    const result = runMigrations();
    expect(result.applied).toContain("001_init.sql");

    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["user", "bike", "profile", "session", "account"]));
  });

  it("is idempotent", () => {
    runMigrations();
    const second = runMigrations();
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain("001_init.sql");
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @mototracker/api test
```
Expected: 2 tests passing.

- [ ] **Step 7: Run migrations against the dev DB**

```bash
pnpm --filter @mototracker/api run migrate
```
Expected: `[migrate] applied: 1, skipped: 0`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db apps/api/tests
git commit -m "feat(api): sqlite connection, migrations runner, init schema"
```

---

## Task 6: BetterAuth integration

**Files:**
- Create: `apps/api/src/auth/email.ts`
- Create: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/server.ts` (mount auth handler before express.json)
- Create: `apps/api/tests/auth.test.ts`

- [ ] **Step 1: Write apps/api/src/auth/email.ts**

```ts
import { Resend } from "resend";
import { config } from "../config.js";

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  if (!resend) {
    console.log(`[email:dev] magic link for ${to}: ${url}`);
    return;
  }
  await resend.emails.send({
    from: config.EMAIL_FROM,
    to,
    subject: "MotoTracker — Giriş bağlantınız",
    text: `MotoTracker'a giriş yapmak için bu bağlantıya tıklayın:\n\n${url}\n\nBağlantı 15 dakika geçerlidir.`,
    html: `<p>MotoTracker'a giriş yapmak için aşağıdaki butona tıklayın:</p><p><a href="${url}">Giriş yap</a></p><p>Bağlantı 15 dakika geçerlidir.</p>`,
  });
}
```

- [ ] **Step 2: Write apps/api/src/auth/index.ts**

```ts
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { sendMagicLinkEmail } from "./email.js";

// BetterAuth accepts a better-sqlite3 instance directly. We hand it ours.
export const auth = betterAuth({
  database: getDb() as unknown as Database.Database,
  baseURL: config.APP_BASE_URL,
  trustedOrigins: [config.WEB_ORIGIN],
  secret: config.SESSION_SECRET,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders:
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: config.GOOGLE_CLIENT_ID,
            clientSecret: config.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
      expiresIn: 15 * 60, // 15 minutes
    }),
  ],
});

export type Auth = typeof auth;
```

- [ ] **Step 3: Modify apps/api/src/server.ts to mount BetterAuth**

Replace the file contents with:

```ts
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { auth } from "./auth/index.js";
import { toNodeHandler } from "better-auth/node";

export interface BuildAppOptions {
  silent?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
    }),
  );
  if (!opts.silent && config.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  // BetterAuth must mount BEFORE express.json so it can read raw bodies.
  app.all("/api/auth/*", toNodeHandler(auth));

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Write apps/api/tests/auth.test.ts**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";

describe("auth: email + password", () => {
  beforeEach(() => {});

  it("rejects /me when not signed in", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(404); // /me not implemented yet -> wired in next task
  });

  it("can sign up a new user via /api/auth/sign-up/email", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ email: "test@example.com", password: "supersecret123", name: "Test" })
      .set("Content-Type", "application/json");
    // BetterAuth returns 200 with session token + user on success
    expect([200, 201]).toContain(res.status);
    expect(res.body.user?.email).toBe("test@example.com");
  });

  it("rejects sign-in with wrong password", async () => {
    const app = buildTestApp();
    await request(app)
      .post("/api/auth/sign-up/email")
      .send({ email: "u2@example.com", password: "rightpassword1", name: "U2" });
    const res = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "u2@example.com", password: "wrongpassword1" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @mototracker/api test
```
Expected: all tests pass. The "/me 404" test reflects that we haven't built it yet — Task 7 will replace it with a 401 expectation.

- [ ] **Step 6: Manually exercise dev server**

```bash
pnpm --filter @mototracker/api dev &
sleep 2
curl -s -i -X POST http://localhost:8787/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"manual@test.com","password":"supersecret123","name":"Manual"}'
kill %1
```
Expected: 200/201 with JSON body containing `user`.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): integrate BetterAuth with email/password, magic link, Google"
```

---

## Task 7: requireUser middleware + /api/me + profile auto-create

**Files:**
- Create: `apps/api/src/middleware/requireUser.ts`
- Create: `apps/api/src/routes/me.ts`
- Modify: `apps/api/src/server.ts` (mount /api/me)
- Modify: `apps/api/tests/auth.test.ts` (replace 404 expectation with /me-authenticated test)
- Create: `apps/api/tests/me.test.ts`

- [ ] **Step 1: Write apps/api/src/middleware/requireUser.ts**

```ts
import type { Request, Response, NextFunction } from "express";
import { auth } from "../auth/index.js";
import { fromNodeHeaders } from "better-auth/node";

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session?.user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  req.user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
  };
  next();
}
```

- [ ] **Step 2: Write apps/api/src/routes/me.ts**

```ts
import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";

export const meRouter: Router = Router();

interface ProfileRow {
  user_id: string;
  language: "tr" | "en";
  timezone: string;
  created_at: string;
}

function getOrCreateProfile(userId: string): ProfileRow {
  const db = getDb();
  const existing = db
    .prepare("SELECT user_id, language, timezone, created_at FROM profile WHERE user_id = ?")
    .get(userId) as ProfileRow | undefined;
  if (existing) return existing;
  db.prepare(
    "INSERT INTO profile (user_id, language, timezone) VALUES (?, 'tr', 'Europe/Istanbul')",
  ).run(userId);
  return db
    .prepare("SELECT user_id, language, timezone, created_at FROM profile WHERE user_id = ?")
    .get(userId) as ProfileRow;
}

meRouter.use(requireUser);

meRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const profile = getOrCreateProfile(req.user!.id);
    res.json({
      user: {
        id: req.user!.id,
        email: req.user!.email,
        name: req.user!.name,
        image: null,
      },
      profile: {
        userId: profile.user_id,
        language: profile.language,
        timezone: profile.timezone,
        createdAt: profile.created_at,
      },
    });
  }),
);

const patchSchema = z.object({
  language: z.enum(["tr", "en"]).optional(),
  timezone: z.string().min(1).optional(),
});

meRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const db = getDb();
    getOrCreateProfile(req.user!.id);
    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (body.language) {
      sets.push("language = ?");
      values.push(body.language);
    }
    if (body.timezone) {
      sets.push("timezone = ?");
      values.push(body.timezone);
    }
    if (sets.length) {
      values.push(req.user!.id);
      db.prepare(`UPDATE profile SET ${sets.join(", ")} WHERE user_id = ?`).run(...values);
    }
    const profile = getOrCreateProfile(req.user!.id);
    res.json({
      userId: profile.user_id,
      language: profile.language,
      timezone: profile.timezone,
      createdAt: profile.created_at,
    });
  }),
);
```

- [ ] **Step 3: Modify apps/api/src/server.ts (add /api/me)**

Find the line:
```ts
  app.use("/api/health", healthRouter);
```
Add immediately after:
```ts
  app.use("/api/me", meRouter);
```
And add the import at the top of the file:
```ts
import { meRouter } from "./routes/me.js";
```

- [ ] **Step 4: Write apps/api/tests/helpers/authedRequest.ts**

```ts
import request from "supertest";
import type { Express } from "express";

export interface AuthedClient {
  cookie: string;
  user: { id: string; email: string };
  agent: ReturnType<typeof request>;
}

export async function signUpAndSignIn(
  app: Express,
  email = `u_${Date.now()}@test.com`,
  password = "supersecret123",
): Promise<AuthedClient> {
  const signup = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ email, password, name: "Test User" });
  const setCookies = signup.headers["set-cookie"];
  if (!setCookies) throw new Error("no Set-Cookie on sign-up; got status " + signup.status);
  const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .map((c: string) => c.split(";")[0])
    .join("; ");
  return {
    cookie,
    user: { id: signup.body.user.id, email: signup.body.user.email },
    agent: request(app),
  };
}
```

- [ ] **Step 5: Update apps/api/tests/auth.test.ts**

Replace the `"rejects /me when not signed in"` test with:

```ts
  it("returns 401 from /api/me when not signed in", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthenticated");
  });
```

- [ ] **Step 6: Write apps/api/tests/me.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/me", () => {
  it("returns user + profile after sign-up (auto-creates profile with tr default)", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    const res = await app
      ? await (await import("supertest")).default(app).get("/api/me").set("Cookie", cookie)
      : null;
    expect(res!.status).toBe(200);
    expect(res!.body.user.id).toBe(user.id);
    expect(res!.body.profile.language).toBe("tr");
    expect(res!.body.profile.timezone).toBe("Europe/Istanbul");
  });

  it("PATCH /api/me updates language", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const supertest = (await import("supertest")).default;
    const res = await supertest(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ language: "en" });
    expect(res.status).toBe(200);
    expect(res.body.language).toBe("en");
  });
});
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @mototracker/api test
```
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): /api/me with auto-created profile + requireUser middleware"
```

---

## Task 8: Bikes CRUD routes

**Files:**
- Create: `apps/api/src/routes/bikes.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/tests/bikes.test.ts`

- [ ] **Step 1: Write apps/api/src/routes/bikes.ts**

```ts
import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { bikeCreateSchema, bikeUpdateSchema } from "@mototracker/shared";

export const bikesRouter: Router = Router();

interface BikeRow {
  id: string;
  user_id: string;
  nickname: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  current_km: number | null;
  color: string | null;
  photo_url: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

function rowToBike(r: BikeRow) {
  return {
    id: r.id,
    userId: r.user_id,
    nickname: r.nickname,
    plate: r.plate,
    make: r.make,
    model: r.model,
    year: r.year,
    currentKm: r.current_km,
    color: r.color,
    photoUrl: r.photo_url,
    archived: r.archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

bikesRouter.use(requireUser);

bikesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.archived === "true";
    const db = getDb();
    const rows = (
      includeArchived
        ? db.prepare("SELECT * FROM bike WHERE user_id = ? ORDER BY created_at DESC").all(req.user!.id)
        : db
            .prepare("SELECT * FROM bike WHERE user_id = ? AND archived = 0 ORDER BY created_at DESC")
            .all(req.user!.id)
    ) as BikeRow[];
    res.json(rows.map(rowToBike));
  }),
);

bikesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = bikeCreateSchema.parse(req.body);
    const id = newId();
    const db = getDb();
    db.prepare(
      `INSERT INTO bike (id, user_id, nickname, plate, make, model, year, current_km, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      body.nickname,
      body.plate ?? null,
      body.make ?? null,
      body.model ?? null,
      body.year ?? null,
      body.currentKm ?? null,
      body.color ?? null,
    );
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(id) as BikeRow;
    res.status(201).json(rowToBike(row));
  }),
);

bikesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as BikeRow | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToBike(row));
  }),
);

bikesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = bikeUpdateSchema.parse(req.body);
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const fieldMap: Record<string, string> = {
      nickname: "nickname",
      plate: "plate",
      make: "make",
      model: "model",
      year: "year",
      currentKm: "current_km",
      color: "color",
    };
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in body) {
        sets.push(`${col} = ?`);
        values.push((body as Record<string, unknown>)[key] as string | number | null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(req.params.id, req.user!.id);
      db.prepare(`UPDATE bike SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(req.params.id) as BikeRow;
    res.json(rowToBike(row));
  }),
);

bikesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db
      .prepare("UPDATE bike SET archived = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  }),
);
```

- [ ] **Step 2: Modify apps/api/src/server.ts to mount bikes**

Add import:
```ts
import { bikesRouter } from "./routes/bikes.js";
```
After `app.use("/api/me", meRouter);` add:
```ts
  app.use("/api/bikes", bikesRouter);
```

- [ ] **Step 3: Write apps/api/tests/bikes.test.ts**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/bikes", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/bikes");
    expect(res.status).toBe(401);
  });

  it("create + list + get + patch + archive", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);

    // create
    const create = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ nickname: "Monster", plate: "34ABC123", make: "Ducati", year: 2023 });
    expect(create.status).toBe(201);
    const id = create.body.id;
    expect(create.body.nickname).toBe("Monster");

    // list
    const list = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);

    // get
    const get1 = await request(app).get(`/api/bikes/${id}`).set("Cookie", cookie);
    expect(get1.status).toBe(200);

    // patch
    const patched = await request(app)
      .patch(`/api/bikes/${id}`)
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ nickname: "Monster 937", currentKm: 1234 });
    expect(patched.status).toBe(200);
    expect(patched.body.nickname).toBe("Monster 937");
    expect(patched.body.currentKm).toBe(1234);

    // archive
    const del = await request(app).delete(`/api/bikes/${id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);

    const list2 = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(list2.body).toHaveLength(0);

    const list3 = await request(app).get("/api/bikes?archived=true").set("Cookie", cookie);
    expect(list3.body).toHaveLength(1);
    expect(list3.body[0].archived).toBe(true);
  });

  it("does not leak bikes across users", async () => {
    const app = buildTestApp();
    const u1 = await signUpAndSignIn(app, "alice@test.com");
    const u2 = await signUpAndSignIn(app, "bob@test.com");

    await request(app)
      .post("/api/bikes")
      .set("Cookie", u1.cookie)
      .set("Content-Type", "application/json")
      .send({ nickname: "Alice's bike" });

    const u2List = await request(app).get("/api/bikes").set("Cookie", u2.cookie);
    expect(u2List.status).toBe(200);
    expect(u2List.body).toHaveLength(0);
  });

  it("rejects malformed body", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ nickname: "" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @mototracker/api test
```
Expected: all bike tests pass plus prior tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): bikes CRUD with per-user isolation"
```

---

## Task 9: Web app skeleton (Vite + Tailwind v4 + shadcn primitives)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vercel.json`
- Create: `apps/web/index.html`
- Create: `apps/web/postcss.config.cjs`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/env.ts`
- Create: `apps/web/src/lib/cn.ts`
- Create: `apps/web/src/components/BrandMark.tsx`
- Create: `apps/web/public/favicon.svg`

- [ ] **Step 1: Write apps/web/package.json**

```json
{
  "name": "@mototracker/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "test": "echo 'no tests yet' && exit 0",
    "lint": "echo 'no lint yet' && exit 0"
  },
  "dependencies": {
    "@mototracker/shared": "workspace:*",
    "@hookform/resolvers": "^3.9.0",
    "@radix-ui/react-dialog": "^1.1.2",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-toast": "^1.2.2",
    "@tanstack/react-query": "^5.59.16",
    "better-auth": "^1.0.21",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "framer-motion": "^11.11.7",
    "lucide-react": "^0.453.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.53.1",
    "react-router-dom": "^6.27.0",
    "tailwind-merge": "^2.5.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.13",
    "typescript": "^5.6.3",
    "vite": "^5.4.9"
  }
}
```

> Tailwind v4 is still pre-release with many breaking changes; v3 is the stable choice for Phase 1. We can migrate to v4 after the rest of the app stabilizes.

- [ ] **Step 2: Write apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "useDefineForClassFields": true,
    "types": ["vite/client"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Write apps/web/tsconfig.node.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "tailwind.config.ts"]
}
```

- [ ] **Step 4: Write apps/web/vite.config.ts**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 5: Write apps/web/vercel.json**

```json
{
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
        { "key": "Service-Worker-Allowed", "value": "/" }
      ]
    }
  ]
}
```

- [ ] **Step 6: Write apps/web/postcss.config.cjs**

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 7: Write apps/web/tailwind.config.ts**

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#F7F7F5", dark: "#0B0B0E" },
        surface: { DEFAULT: "#FFFFFF", dark: "#15151A" },
        "surface-elev": { DEFAULT: "#FFFFFF", dark: "#1D1D24" },
        border: { DEFAULT: "#E6E6E2", dark: "#2A2A33" },
        text: { DEFAULT: "#0B0B0E", dark: "#F4F4F2" },
        muted: { DEFAULT: "#6B6B72", dark: "#9A9AA3" },
        accent: { DEFAULT: "#E1FF4D" },
        success: { DEFAULT: "#37D67A" },
        warning: { DEFAULT: "#F2A93B" },
        danger: { DEFAULT: "#FF4757" },
      },
      fontFamily: {
        sans: ["Geist", "Inter", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { xl: "20px" },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 8: Write apps/web/src/styles.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light dark;
}

html {
  background: theme(colors.bg.DEFAULT);
  color: theme(colors.text.DEFAULT);
}

@media (prefers-color-scheme: dark) {
  html {
    background: theme(colors.bg.dark);
    color: theme(colors.text.dark);
  }
}

body {
  font-family: theme(fontFamily.sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
```

- [ ] **Step 9: Write apps/web/index.html**

```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0B0B0E" />
    <title>MotoTracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Write apps/web/public/favicon.svg**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0B0B0E"/><circle cx="10" cy="22" r="5" fill="none" stroke="#E1FF4D" stroke-width="2"/><circle cx="22" cy="22" r="5" fill="none" stroke="#E1FF4D" stroke-width="2"/><path d="M10 22 L16 12 L22 22" fill="none" stroke="#E1FF4D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 11: Write apps/web/src/env.ts**

```ts
import { z } from "zod";

const Env = z.object({
  VITE_API_URL: z.string().url().default("http://localhost:8787"),
});

export const env = Env.parse(import.meta.env);
```

- [ ] **Step 12: Write apps/web/src/lib/cn.ts**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 13: Write apps/web/src/components/BrandMark.tsx**

```tsx
import { motion } from "framer-motion";

export function BrandMark({ className }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}
    >
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
        <circle cx="10" cy="22" r="5" fill="none" stroke="currentColor" strokeWidth="2"/>
        <circle cx="22" cy="22" r="5" fill="none" stroke="currentColor" strokeWidth="2"/>
        <path d="M10 22 L16 12 L22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span>MotoTracker</span>
    </motion.div>
  );
}
```

- [ ] **Step 14: Write apps/web/src/main.tsx**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 15: Write apps/web/src/App.tsx (placeholder, replaced in next task)**

```tsx
import { BrandMark } from "./components/BrandMark";

export function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <BrandMark className="text-3xl" />
    </div>
  );
}
```

- [ ] **Step 16: Install + run dev server**

```bash
pnpm install
pnpm --filter @mototracker/web dev &
sleep 3
curl -sI http://localhost:5173/
kill %1
```
Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 17: Commit**

```bash
git add apps/web
git commit -m "feat(web): vite + tailwind + shadcn primitives + brand mark"
```

---

## Task 10: shadcn primitives (button, input, label, card, toast)

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/input.tsx`
- Create: `apps/web/src/components/ui/label.tsx`
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/toast.tsx`
- Create: `apps/web/src/components/ui/toaster.tsx`
- Create: `apps/web/src/hooks/useToast.ts`

- [ ] **Step 1: Write apps/web/src/components/ui/button.tsx**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-text text-bg hover:opacity-90 dark:bg-text-dark dark:text-bg-dark",
        accent: "bg-accent text-bg hover:opacity-90",
        outline: "border border-border bg-transparent hover:bg-surface dark:border-border-dark dark:hover:bg-surface-elev-dark",
        ghost: "hover:bg-surface dark:hover:bg-surface-elev-dark",
        danger: "bg-danger text-white hover:opacity-90",
      },
      size: {
        sm: "h-9 px-3",
        md: "h-11 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";
```

- [ ] **Step 2: Write apps/web/src/components/ui/input.tsx**

```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm",
        "placeholder:text-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-border-dark dark:bg-surface-dark dark:text-text-dark",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
```

- [ ] **Step 3: Write apps/web/src/components/ui/label.tsx**

```tsx
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/cn";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("text-sm font-medium leading-none text-text dark:text-text-dark", className)}
    {...props}
  />
));
Label.displayName = "Label";
```

- [ ] **Step 4: Write apps/web/src/components/ui/card.tsx**

```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-surface p-6 shadow-sm",
        "dark:border-border-dark dark:bg-surface-dark",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mb-4 flex flex-col gap-1.5", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-lg font-semibold tracking-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted dark:text-muted-dark", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("flex flex-col gap-4", className)} {...props} />,
);
CardContent.displayName = "CardContent";
```

- [ ] **Step 5: Write apps/web/src/hooks/useToast.ts**

```ts
// Minimal shadcn-style toast — single global store, primitive used by Toaster.
import * as React from "react";

type ToastVariant = "default" | "danger" | "success";
export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

type Listener = (toasts: Toast[]) => void;
let toasts: Toast[] = [];
const listeners: Listener[] = [];

function emit() {
  for (const l of listeners) l(toasts);
}

export function pushToast(t: Omit<Toast, "id">) {
  const id = Math.random().toString(36).slice(2, 9);
  const toast: Toast = { id, durationMs: 4000, ...t };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  }, toast.durationMs);
}

export function useToasts(): Toast[] {
  const [state, setState] = React.useState<Toast[]>(toasts);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const i = listeners.indexOf(setState);
      if (i >= 0) listeners.splice(i, 1);
    };
  }, []);
  return state;
}
```

- [ ] **Step 6: Write apps/web/src/components/ui/toaster.tsx**

```tsx
import { AnimatePresence, motion } from "framer-motion";
import { useToasts } from "@/hooks/useToast";
import { cn } from "@/lib/cn";

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center">
      <div className="flex w-full max-w-sm flex-col gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              className={cn(
                "pointer-events-auto rounded-xl border bg-surface p-3 shadow-md",
                "dark:bg-surface-dark dark:border-border-dark",
                t.variant === "danger" && "border-danger/40",
                t.variant === "success" && "border-success/40",
              )}
            >
              {t.title && <div className="text-sm font-medium">{t.title}</div>}
              {t.description && <div className="text-sm text-muted dark:text-muted-dark">{t.description}</div>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify dev server still builds**

```bash
pnpm --filter @mototracker/web dev &
sleep 3
curl -sI http://localhost:5173/
kill %1
```
Expected: 200.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): shadcn primitives (button, input, label, card, toast)"
```

---

## Task 11: API client + auth client + TanStack Query setup

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/authClient.ts`
- Create: `apps/web/src/lib/queryClient.ts`
- Create: `apps/web/src/hooks/useMe.ts`
- Create: `apps/web/src/hooks/useBikes.ts`

- [ ] **Step 1: Write apps/web/src/lib/api.ts**

```ts
import { env } from "@/env";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export interface ApiOptions extends RequestInit {
  json?: unknown;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { json, headers, ...rest } = opts;
  const res = await fetch(`${env.VITE_API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json ? JSON.stringify(json) : (rest.body as BodyInit | undefined),
  });
  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    throw new ApiError(res.status, `${rest.method ?? "GET"} ${path} failed (${res.status})`, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

- [ ] **Step 2: Write apps/web/src/lib/authClient.ts**

```ts
import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { env } from "@/env";

export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
```

- [ ] **Step 3: Write apps/web/src/lib/queryClient.ts**

```ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});
```

- [ ] **Step 4: Write apps/web/src/hooks/useMe.ts**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MeResponse } from "@mototracker/shared";

export function useMe() {
  return useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
  });
}
```

- [ ] **Step 5: Write apps/web/src/hooks/useBikes.ts**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Bike, BikeCreateInput, BikeUpdateInput } from "@mototracker/shared";

const KEY = ["bikes"] as const;

export function useBikes() {
  return useQuery<Bike[]>({
    queryKey: KEY,
    queryFn: () => api<Bike[]>("/api/bikes"),
  });
}

export function useBike(id: string | undefined) {
  return useQuery<Bike>({
    queryKey: ["bikes", id],
    queryFn: () => api<Bike>(`/api/bikes/${id}`),
    enabled: !!id,
  });
}

export function useCreateBike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BikeCreateInput) => api<Bike>("/api/bikes", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateBike(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BikeUpdateInput) => api<Bike>(`/api/bikes/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useArchiveBike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/bikes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): api client, BetterAuth client, TanStack Query hooks"
```

---

## Task 12: Router + AppShell + Sign-in / Sign-up pages

**Files:**
- Create: `apps/web/src/components/AppShell.tsx`
- Create: `apps/web/src/pages/SignInPage.tsx`
- Create: `apps/web/src/pages/SignUpPage.tsx`
- Create: `apps/web/src/pages/MagicLinkSentPage.tsx`
- Create: `apps/web/src/pages/AuthCallbackPage.tsx`
- Create: `apps/web/src/pages/NotFoundPage.tsx`
- Create: `apps/web/src/routes.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write apps/web/src/components/AppShell.tsx**

```tsx
import { Outlet, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { signOut } from "@/lib/authClient";

export function AppShell() {
  const me = useMe();
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur dark:border-border-dark dark:bg-bg-dark/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <BrandMark />
          {me.data && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOut();
                navigate("/sign-in");
              }}
            >
              <LogOut className="h-4 w-4" /> Çıkış
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write apps/web/src/pages/SignInPage.tsx**

```tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

const schema = z.object({
  email: z.string().email("Geçerli e-posta girin"),
  password: z.string().min(8, "En az 8 karakter"),
});
type FormValues = z.infer<typeof schema>;

export function SignInPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    const res = await signIn.email({ email: v.email, password: v.password });
    setBusy(false);
    if (res.error) {
      pushToast({ variant: "danger", title: "Giriş başarısız", description: res.error.message });
      return;
    }
    navigate("/bikes");
  });

  const onMagic = async () => {
    const email = form.getValues("email");
    if (!email) {
      form.setError("email", { message: "Önce e-posta girin" });
      return;
    }
    setBusy(true);
    const res = await signIn.magicLink({ email, callbackURL: "/auth/callback" });
    setBusy(false);
    if (res.error) {
      pushToast({ variant: "danger", title: "Bağlantı gönderilemedi", description: res.error.message });
      return;
    }
    navigate("/magic-link-sent");
  };

  const onGoogle = async () => {
    setBusy(true);
    await signIn.social({ provider: "google", callbackURL: "/auth/callback" });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Tekrar hoş geldin</CardTitle>
          <CardDescription>Hesabınla giriş yap.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="email">E-posta</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              {form.formState.errors.email && (
                <p className="text-xs text-danger">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="password">Şifre</Label>
              <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
              {form.formState.errors.password && (
                <p className="text-xs text-danger">{form.formState.errors.password.message}</p>
              )}
            </div>
            <Button type="submit" disabled={busy}>Giriş yap</Button>
          </form>
          <div className="my-4 flex items-center gap-2 text-xs text-muted dark:text-muted-dark">
            <div className="h-px flex-1 bg-border dark:bg-border-dark" /> veya <div className="h-px flex-1 bg-border dark:bg-border-dark" />
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={onMagic} disabled={busy}>Sihirli bağlantı gönder</Button>
            <Button variant="outline" onClick={onGoogle} disabled={busy}>Google ile giriş</Button>
          </div>
          <p className="mt-4 text-center text-sm text-muted dark:text-muted-dark">
            Hesabın yok mu? <Link to="/sign-up" className="underline">Kayıt ol</Link>
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
```

- [ ] **Step 3: Write apps/web/src/pages/SignUpPage.tsx**

```tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

const schema = z.object({
  name: z.string().min(1, "Ad gerekli"),
  email: z.string().email("Geçerli e-posta girin"),
  password: z.string().min(8, "En az 8 karakter"),
});
type FormValues = z.infer<typeof schema>;

export function SignUpPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    const res = await signUp.email({ email: v.email, password: v.password, name: v.name });
    setBusy(false);
    if (res.error) {
      pushToast({ variant: "danger", title: "Kayıt başarısız", description: res.error.message });
      return;
    }
    navigate("/bikes");
  });

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Hesap oluştur</CardTitle>
          <CardDescription>MotoTracker ile motosikletini takip etmeye başla.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div>
              <Label htmlFor="name">Ad</Label>
              <Input id="name" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-danger">{form.formState.errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="email">E-posta</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              {form.formState.errors.email && <p className="text-xs text-danger">{form.formState.errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">Şifre</Label>
              <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
              {form.formState.errors.password && <p className="text-xs text-danger">{form.formState.errors.password.message}</p>}
            </div>
            <Button type="submit" disabled={busy}>Hesap oluştur</Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted dark:text-muted-dark">
            Zaten hesabın var mı? <Link to="/sign-in" className="underline">Giriş yap</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Write apps/web/src/pages/MagicLinkSentPage.tsx**

```tsx
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function MagicLinkSentPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Bağlantı gönderildi</CardTitle>
          <CardDescription>E-postanı kontrol et ve giriş bağlantısına tıkla.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted dark:text-muted-dark">
            Bağlantı 15 dakika geçerli. Spam kutusunu da kontrol etmeyi unutma.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Write apps/web/src/pages/AuthCallbackPage.tsx**

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "@/hooks/useMe";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const me = useMe();
  useEffect(() => {
    if (me.isSuccess) navigate("/bikes", { replace: true });
    if (me.isError) navigate("/sign-in", { replace: true });
  }, [me.isSuccess, me.isError, navigate]);
  return <p className="text-center text-muted dark:text-muted-dark">Yönlendiriliyor...</p>;
}
```

- [ ] **Step 6: Write apps/web/src/pages/NotFoundPage.tsx**

```tsx
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-2xl font-semibold">Sayfa bulunamadı</h1>
      <p className="mt-2 text-muted dark:text-muted-dark">Aradığın sayfa burada değil.</p>
      <Link to="/bikes" className="mt-4 inline-block underline">Anasayfaya dön</Link>
    </div>
  );
}
```

- [ ] **Step 7: Write apps/web/src/routes.tsx**

```tsx
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { SignInPage } from "@/pages/SignInPage";
import { SignUpPage } from "@/pages/SignUpPage";
import { MagicLinkSentPage } from "@/pages/MagicLinkSentPage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { BikesPage } from "@/pages/BikesPage";
import { BikeFormPage } from "@/pages/BikeFormPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { useSession } from "@/lib/authClient";
import { Toaster } from "@/components/ui/toaster";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  if (isPending) return <p className="text-center text-muted dark:text-muted-dark">...</p>;
  if (!data) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: "/sign-in", element: <SignInPage /> },
  { path: "/sign-up", element: <SignUpPage /> },
  { path: "/magic-link-sent", element: <MagicLinkSentPage /> },
  { path: "/auth/callback", element: <AuthCallbackPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/bikes" replace /> },
      { path: "bikes", element: <BikesPage /> },
      { path: "bikes/new", element: <BikeFormPage /> },
      { path: "bikes/:id/edit", element: <BikeFormPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

export function Routes() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 8: Modify apps/web/src/App.tsx**

```tsx
import { Routes } from "./routes";
export function App() {
  return <Routes />;
}
```

- [ ] **Step 9: Commit (BikesPage and BikeFormPage will be added in Task 13; build will be temporarily broken)**

Skip the commit until next task — keep the working tree progressing.

---

## Task 13: Bikes list page + add/edit form

**Files:**
- Create: `apps/web/src/pages/BikesPage.tsx`
- Create: `apps/web/src/pages/BikeFormPage.tsx`

- [ ] **Step 1: Write apps/web/src/pages/BikesPage.tsx**

```tsx
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Bike as BikeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBikes } from "@/hooks/useBikes";

export function BikesPage() {
  const { data, isLoading, isError } = useBikes();

  if (isLoading) return <p className="text-center text-muted dark:text-muted-dark">Yükleniyor...</p>;
  if (isError) return <p className="text-center text-danger">Yüklenemedi.</p>;

  if (!data || data.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center"
      >
        <BikeIcon className="h-12 w-12 text-muted dark:text-muted-dark" />
        <div>
          <h1 className="text-xl font-semibold">Henüz motosiklet eklemedin</h1>
          <p className="mt-1 text-sm text-muted dark:text-muted-dark">
            İlk motosikletini ekleyerek başla.
          </p>
        </div>
        <Button asChild variant="accent">
          <Link to="/bikes/new"><Plus className="h-4 w-4" /> Bir motosiklet ekle</Link>
        </Button>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Motosikletlerim</h1>
        <Button asChild size="sm" variant="accent">
          <Link to="/bikes/new"><Plus className="h-4 w-4" /> Ekle</Link>
        </Button>
      </div>
      <div className="grid gap-3">
        {data.map((b) => (
          <motion.div key={b.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Link to={`/bikes/${b.id}/edit`}>
              <Card className="flex items-center justify-between hover:border-accent">
                <div>
                  <div className="font-semibold">{b.nickname}</div>
                  <div className="text-sm text-muted dark:text-muted-dark">
                    {[b.make, b.model, b.year].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {b.plate && <div className="mt-1 font-mono text-xs">{b.plate}</div>}
                </div>
                <BikeIcon className="h-6 w-6 text-muted dark:text-muted-dark" />
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write apps/web/src/pages/BikeFormPage.tsx**

```tsx
import { useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBike, useCreateBike, useUpdateBike, useArchiveBike } from "@/hooks/useBikes";
import { pushToast } from "@/hooks/useToast";

const schema = z.object({
  nickname: z.string().min(1, "Ad gerekli").max(80),
  plate: z.string().max(20).optional().or(z.literal("")),
  make: z.string().max(60).optional().or(z.literal("")),
  model: z.string().max(60).optional().or(z.literal("")),
  year: z
    .union([z.coerce.number().int().min(1900).max(2100), z.literal("")])
    .optional(),
  currentKm: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  color: z.string().max(40).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

export function BikeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const bike = useBike(id);
  const createMut = useCreateBike();
  const updateMut = useUpdateBike(id ?? "");
  const archiveMut = useArchiveBike();

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { nickname: "" } });

  useEffect(() => {
    if (isEdit && bike.data) {
      form.reset({
        nickname: bike.data.nickname,
        plate: bike.data.plate ?? "",
        make: bike.data.make ?? "",
        model: bike.data.model ?? "",
        year: bike.data.year ?? "",
        currentKm: bike.data.currentKm ?? "",
        color: bike.data.color ?? "",
      });
    }
  }, [isEdit, bike.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const payload = {
      nickname: v.nickname,
      plate: v.plate || null,
      make: v.make || null,
      model: v.model || null,
      year: typeof v.year === "number" ? v.year : null,
      currentKm: typeof v.currentKm === "number" ? v.currentKm : null,
      color: v.color || null,
    };
    try {
      if (isEdit && id) {
        await updateMut.mutateAsync(payload);
        pushToast({ variant: "success", title: "Güncellendi" });
      } else {
        await createMut.mutateAsync(payload);
        pushToast({ variant: "success", title: "Eklendi" });
      }
      navigate("/bikes");
    } catch (e) {
      pushToast({ variant: "danger", title: "Kaydedilemedi", description: String(e) });
    }
  });

  const onArchive = async () => {
    if (!id) return;
    if (!confirm("Bu motosikleti arşivlemek istiyor musun?")) return;
    await archiveMut.mutateAsync(id);
    navigate("/bikes");
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? "Motosikleti düzenle" : "Yeni motosiklet"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field label="Takma ad" error={form.formState.errors.nickname?.message}>
              <Input {...form.register("nickname")} placeholder="ör. Monster" />
            </Field>
            <Field label="Plaka">
              <Input {...form.register("plate")} placeholder="34 ABC 123" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Marka">
                <Input {...form.register("make")} placeholder="Ducati" />
              </Field>
              <Field label="Model">
                <Input {...form.register("model")} placeholder="Monster 937" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Yıl">
                <Input type="number" {...form.register("year")} placeholder="2023" />
              </Field>
              <Field label="Şu anki km">
                <Input type="number" {...form.register("currentKm")} placeholder="12000" />
              </Field>
            </div>
            <Field label="Renk">
              <Input {...form.register("color")} placeholder="Kırmızı" />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="accent" className="flex-1">
                {isEdit ? "Kaydet" : "Ekle"}
              </Button>
              <Button asChild variant="ghost" className="flex-1"><Link to="/bikes">İptal</Link></Button>
            </div>
            {isEdit && (
              <Button type="button" variant="danger" onClick={onArchive}>
                <Trash2 className="h-4 w-4" /> Arşivle
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Build the web app to catch type errors**

```bash
pnpm --filter @mototracker/web build
```
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test**

```bash
pnpm --filter @mototracker/api dev &
pnpm --filter @mototracker/web dev &
sleep 4
```

Open `http://localhost:5173` in a browser:
1. You're redirected to `/sign-in`.
2. Click "Kayıt ol", create an account → you land on `/bikes` with the empty state.
3. Click "Bir motosiklet ekle", fill the form, submit → you're back on the list with one bike.
4. Click the bike → edit form opens with values populated. Edit and save.
5. Click "Çıkış" → you're back on `/sign-in`.

```bash
kill %1 %2
```

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): router, auth pages, bikes list and form"
```

---

## Task 14: Docker compose for self-host (api + cloudflared placeholder)

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `mototracker/docker-compose.yml`
- Create: `mototracker/.env.example`

- [ ] **Step 1: Write apps/api/Dockerfile**

```dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ sqlite
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mototracker/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./
COPY --from=build /repo/apps/api/src/db/migrations ./dist/db/migrations
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./node_modules
EXPOSE 8787
VOLUME ["/data"]
ENV DATABASE_PATH=/data/app.db
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Write docker-compose.yml**

```yaml
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: mototracker-api
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 8787
      DATABASE_PATH: /data/app.db
      WEB_ORIGIN: ${WEB_ORIGIN}
      APP_BASE_URL: ${APP_BASE_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      RESEND_API_KEY: ${RESEND_API_KEY:-}
      EMAIL_FROM: ${EMAIL_FROM:-MotoTracker <noreply@example.com>}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
    volumes:
      - ./data:/data
    ports:
      - "127.0.0.1:8787:8787"

  ollama:
    image: ollama/ollama:latest
    container_name: mototracker-ollama
    restart: unless-stopped
    ports:
      - "127.0.0.1:11434:11434"
    volumes:
      - ./ollama:/root/.ollama

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: mototracker-tunnel
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARED_TOKEN}
    depends_on:
      - api
```

- [ ] **Step 3: Write root .env.example**

```env
# Public origin of the React PWA (Vercel)
WEB_ORIGIN=https://mototracker.vercel.app
# Base URL of the self-hosted API (your tunnel domain)
APP_BASE_URL=https://api.mototracker.example.com
# Random 32+ char string
SESSION_SECRET=

# Email (optional, for magic links — falls back to console log if absent)
RESEND_API_KEY=
EMAIL_FROM="MotoTracker <noreply@example.com>"

# Google OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Cloudflare Tunnel token (from `cloudflared tunnel token <name>`)
CLOUDFLARED_TOKEN=
```

- [ ] **Step 4: Validate compose syntax**

```bash
docker compose -f docker-compose.yml config > /dev/null
```
Expected: no output (validates).

- [ ] **Step 5: Commit**

```bash
git add apps/api/Dockerfile docker-compose.yml .env.example
git commit -m "chore: docker compose for api + ollama + cloudflared"
```

---

## Task 15: README expansion + Vercel deploy notes

**Files:**
- Modify: `mototracker/README.md`

- [ ] **Step 1: Replace README.md contents**

```markdown
# MotoTracker

Self-hosted PWA that tracks motorcycle Sigorta / Kasko / Muayene expiry dates with photo-based OCR (local Ollama vision model) and Web Push reminders.

- **Frontend** (`apps/web`): React + Vite + Tailwind, deployed to Vercel.
- **Backend** (`apps/api`): Node + Express + better-sqlite3 + BetterAuth, self-hosted via Docker.
- **OCR**: Ollama vision model (e.g. `gemma3:4b`) running on the same host as the API.
- **Edge**: Cloudflare Tunnel exposes the API at `api.<your-domain>` over HTTPS.

See `docs/superpowers/specs/2026-05-08-mototracker-design.md` for the full design.

## Phase status

- [x] Phase 1 — Foundation + Auth (this branch)
- [ ] Phase 2 — Dashboard + Dated Items
- [ ] Phase 3 — OCR Pipeline
- [ ] Phase 4 — Notifications + Maintenance + Polish

## Local development

Prereqs: Node 20, pnpm 9, Docker Desktop (optional for Ollama).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env (SESSION_SECRET at minimum)
pnpm --filter @mototracker/api migrate
pnpm dev:api      # http://localhost:8787
pnpm dev:web      # http://localhost:5173
```

Vite proxies `/api` → `http://localhost:8787` so cookies work cross-origin in dev.

### Tests

```bash
pnpm --filter @mototracker/api test
```

## Self-host (production)

1. Provision a Cloudflare Tunnel: `cloudflared tunnel login`, then `cloudflared tunnel create mototracker`. Note the token.
2. Point `api.<your-domain>` at the tunnel in the Cloudflare dashboard.
3. Copy `.env.example` to `.env` at the repo root and fill in: `WEB_ORIGIN`, `APP_BASE_URL`, `SESSION_SECRET`, `CLOUDFLARED_TOKEN`, plus optional `RESEND_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`.
4. `docker compose up -d`
5. Pull the Ollama vision model (Phase 3): `docker exec mototracker-ollama ollama pull gemma3:4b`

## Frontend deploy (Vercel)

1. New Vercel project pointing at this repo, root directory `apps/web`.
2. Build command: `pnpm --filter @mototracker/web build`. Output: `apps/web/dist`.
3. Env vars on Vercel:
   - `VITE_API_URL=https://api.<your-domain>`
4. Vercel will use `apps/web/vercel.json` for the SPA rewrite + service-worker headers.

## Repo layout

```
apps/
  api/        # Express + SQLite + BetterAuth
  web/        # React PWA → Vercel
packages/
  shared/     # zod schemas
docker-compose.yml
docs/superpowers/
  specs/      # design docs
  plans/      # implementation plans
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with phase status, dev + self-host + deploy instructions"
```

---

## Task 16: End-to-end smoke test (manual)

This is a verification gate, not new code.

- [ ] **Step 1: Fresh DB**

```bash
rm -f apps/api/data/app.db apps/api/data/app.db-*
pnpm --filter @mototracker/api migrate
```

- [ ] **Step 2: Start both processes**

```bash
pnpm dev:api &
pnpm dev:web &
sleep 4
```

- [ ] **Step 3: Walk through the user journey**

In a browser:

1. Visit `http://localhost:5173` → redirected to `/sign-in`.
2. Click "Kayıt ol" → create account `me@local.test` / `password123` → land on `/bikes` empty state.
3. Click "Bir motosiklet ekle" → fill (Monster / 34 ABC 123 / Ducati / Monster 937 / 2023) → submit → see it on list.
4. Click the bike → edit page populated → change `currentKm` to 1000 → save → it's reflected.
5. Click "Çıkış" → back on sign-in.
6. Sign in via "Sihirli bağlantı gönder" using the same email. The console output of the API process shows the magic link URL — copy & open it. You're back on `/bikes`.

- [ ] **Step 4: Stop processes**

```bash
kill %1 %2
```

- [ ] **Step 5: Tag the phase**

```bash
git tag phase-1-foundation
```

---

## Self-Review

**Spec coverage:** Phase 1 covers spec sections 2 (architecture), 3 (auth + bike tables), 8 (`/api/me`, `/api/bikes`). Spec sections 4 (OCR), 5 (push), 6 (UX detail beyond auth + bikes), 7 (full visual direction beyond color tokens), and 9–11 are intentionally out of scope for Phase 1.

**Placeholder scan:** No TBDs / TODOs / "implement later" left. Tailwind v4 was downgraded to v3 with an explicit reason. The `vercel.json` `Service-Worker-Allowed` header is in place even though we add the SW in Phase 4 — harmless to have early.

**Type consistency:** `MeResponse`, `Bike`, `BikeCreateInput`, `BikeUpdateInput` defined in `packages/shared` and imported by the API + web. SQL column names use snake_case; TypeScript fields use camelCase; conversion is centralized in `rowToBike`.

**Known gaps acknowledged in this plan:**
- Service worker / PWA manifest not yet added (Phase 4).
- No protected route for `BikesPage` data preloading; `RequireAuth` already handles unauth redirect.
- No optimistic updates; relies on `invalidateQueries`.
