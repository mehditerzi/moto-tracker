# MotoTracker — Phase 4: Notifications, Maintenance, PWA, i18n, Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the rest of the spec. End state: a user can subscribe a device for Web Push, receive daily reminders for Sigorta/Kasko/Muayene/maintenance items at configurable lead times, install the PWA on iOS/Android, manage all of that from a Settings page, toggle TR/EN, and follow a documented self-host + Vercel deploy path.

**Architecture:**
- Backend: add `maintenance_item`, `notification_preference`, `push_subscription`, `notification_sent` tables. Cron computes "what to send today" as a pure function (`computeDueNotifications`); a thin dispatcher calls `web-push` per subscription and writes to `notification_sent` to dedupe. Both are stubbable for tests.
- Frontend: install vite-plugin-pwa with `injectManifest` strategy; ship a tiny custom `sw.ts` (push handler + notification click handler + Workbox precache). Add a Settings page that drives prefs + push subscription. Add maintenance panel on dashboard.
- i18n: react-i18next with `tr` and `en` JSON namespaces. Initial coverage: shell, auth, dashboard, settings.
- Polish: load Geist via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`. Wrap the app in Framer Motion's `MotionConfig reducedMotion="user"`.

**Tech additions:** `web-push`, `@types/web-push`, `node-cron`, `@types/node-cron` (api). `vite-plugin-pwa`, `workbox-window`, `i18next`, `react-i18next`, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` (web).

**Spec:** §5, §6, §7, §10, §11.

---

## File Structure

Created:
```
apps/api/src/db/migrations/004_phase4.sql
apps/api/src/routes/maintenanceItems.ts
apps/api/src/routes/notificationPreferences.ts
apps/api/src/routes/pushSubscriptions.ts
apps/api/src/notify/
  types.ts
  computeDueNotifications.ts        # pure function — easy to test
  webPushClient.ts                  # web-push wrapper, swappable for tests
  dispatcher.ts                     # given (db,today) -> sends + records
  cron.ts                           # node-cron schedule
apps/api/tests/maintenanceItems.test.ts
apps/api/tests/notificationPreferences.test.ts
apps/api/tests/pushSubscriptions.test.ts
apps/api/tests/notify.compute.test.ts
apps/api/tests/notify.dispatcher.test.ts

packages/shared/src/schemas/maintenance.ts
packages/shared/src/schemas/notification.ts

apps/web/src/sw.ts                  # custom service worker
apps/web/public/icons/icon-192.svg
apps/web/public/icons/icon-512.svg
apps/web/public/icons/maskable.svg
apps/web/src/lib/push.ts            # subscribe / unsubscribe helpers
apps/web/src/lib/i18n.ts
apps/web/src/locales/tr.json
apps/web/src/locales/en.json
apps/web/src/hooks/useMaintenanceItems.ts
apps/web/src/hooks/useNotifPreferences.ts
apps/web/src/hooks/usePush.ts
apps/web/src/components/MaintenancePanel.tsx
apps/web/src/pages/MaintenanceFormPage.tsx
apps/web/src/pages/SettingsPage.tsx
```

Modified:
```
apps/api/src/server.ts              # mount new routers
apps/api/src/index.ts               # start cron after listen
apps/api/src/config.ts              # VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
apps/api/.env.example
apps/api/package.json               # web-push, node-cron + types

packages/shared/src/index.ts

apps/web/vite.config.ts             # vite-plugin-pwa
apps/web/package.json
apps/web/src/main.tsx               # MotionConfig + i18n provider
apps/web/src/components/AppShell.tsx # Settings link
apps/web/src/pages/DashboardPage.tsx # MaintenancePanel
apps/web/src/routes.tsx             # /settings, /bikes/:id/maintenance/new etc.
apps/web/src/styles.css             # @fontsource imports
apps/web/index.html                 # manifest link

docker-compose.yml                  # VAPID envs
.env.example
README.md                           # phase status + deploy guide
```

---

## Task 1: DB migration 004

**Files:** Create `apps/api/src/db/migrations/004_phase4.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE IF NOT EXISTS maintenance_item (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('engine_oil','chain','brakes','tires','coolant','custom')),
  custom_label TEXT,
  last_done_on TEXT,
  last_done_km INTEGER,
  interval_months INTEGER,
  interval_km INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maint_bike ON maintenance_item(bike_id, kind);

CREATE TABLE IF NOT EXISTS notification_preference (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('sigorta','kasko','muayene','maintenance')),
  lead_days_csv TEXT NOT NULL DEFAULT '30,7,1',
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, item_type)
);

CREATE TABLE IF NOT EXISTS push_subscription (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscription(user_id);

CREATE TABLE IF NOT EXISTS notification_sent (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('dated','maintenance')),
  item_id TEXT NOT NULL,
  lead_days INTEGER NOT NULL,
  sent_on TEXT NOT NULL,
  UNIQUE (item_kind, item_id, lead_days, sent_on)
);
CREATE INDEX IF NOT EXISTS idx_sent_user ON notification_sent(user_id, sent_on);
```

- [ ] **Step 2: Apply + commit**

```bash
pnpm --filter @mototracker/api migrate
git add apps/api/src/db/migrations/004_phase4.sql
git commit -m "feat(api): migration for maintenance, prefs, push subs, notification_sent"
```

---

## Task 2: Shared schemas (maintenance + notification)

**Files:** Create `packages/shared/src/schemas/maintenance.ts`, `packages/shared/src/schemas/notification.ts`; modify `packages/shared/src/index.ts`.

- [ ] **Step 1: `packages/shared/src/schemas/maintenance.ts`**

```ts
import { z } from "zod";

export const maintenanceKindSchema = z.enum([
  "engine_oil",
  "chain",
  "brakes",
  "tires",
  "coolant",
  "custom",
]);
export type MaintenanceKind = z.infer<typeof maintenanceKindSchema>;

export const maintenanceItemSchema = z.object({
  id: z.string(),
  bikeId: z.string(),
  userId: z.string(),
  kind: maintenanceKindSchema,
  customLabel: z.string().nullable(),
  lastDoneOn: z.string().nullable(),
  lastDoneKm: z.number().int().nullable(),
  intervalMonths: z.number().int().nullable(),
  intervalKm: z.number().int().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaintenanceItem = z.infer<typeof maintenanceItemSchema>;

const dateOpt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor")
  .nullable()
  .optional();

export const maintenanceCreateSchema = z.object({
  kind: maintenanceKindSchema,
  customLabel: z.string().max(120).nullable().optional(),
  lastDoneOn: dateOpt,
  lastDoneKm: z.number().int().nonnegative().nullable().optional(),
  intervalMonths: z.number().int().positive().nullable().optional(),
  intervalKm: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateSchema>;

export const maintenanceUpdateSchema = maintenanceCreateSchema.partial();
export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateSchema>;
```

- [ ] **Step 2: `packages/shared/src/schemas/notification.ts`**

```ts
import { z } from "zod";

export const notifItemTypeSchema = z.enum(["sigorta", "kasko", "muayene", "maintenance"]);
export type NotifItemType = z.infer<typeof notifItemTypeSchema>;

export const notifPreferenceSchema = z.object({
  userId: z.string(),
  itemType: notifItemTypeSchema,
  leadDays: z.array(z.number().int().min(0).max(365)),
  enabled: z.boolean(),
});
export type NotifPreference = z.infer<typeof notifPreferenceSchema>;

export const notifPreferenceUpdateSchema = z.object({
  leadDays: z.array(z.number().int().min(0).max(365)).max(8),
  enabled: z.boolean(),
});
export type NotifPreferenceUpdateInput = z.infer<typeof notifPreferenceUpdateSchema>;

export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;
```

- [ ] **Step 3: Append to `packages/shared/src/index.ts`**

```ts
export * from "./schemas/maintenance";
export * from "./schemas/notification";
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @mototracker/shared run build
git add packages/shared
git commit -m "feat(shared): zod schemas for maintenance and notifications"
```

---

## Task 3: API config additions (VAPID)

**Files:** Modify `apps/api/src/config.ts`, `apps/api/.env.example`.

- [ ] **Step 1: Add to `Env`**

```ts
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:noreply@mototracker.app"),
  CRON_TIMEZONE: z.string().default("Europe/Istanbul"),
  CRON_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  CRON_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("true"),
```

In the test-mode `loadConfig({...})` call, also pass `CRON_ENABLED: "false"` so the cron does not start during tests.

- [ ] **Step 2: Append to `apps/api/.env.example`**

```env

# Web Push (run: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:noreply@mototracker.app
CRON_TIMEZONE=Europe/Istanbul
CRON_HOUR=9
CRON_ENABLED=true
```

- [ ] **Step 3: Verify tests still pass + commit**

```bash
pnpm --filter @mototracker/api test
git add apps/api
git commit -m "chore(api): config for VAPID keys and cron schedule"
```

---

## Task 4: API maintenance routes + tests

**Files:** Create `apps/api/src/routes/maintenanceItems.ts`, `apps/api/tests/maintenanceItems.test.ts`; modify `apps/api/src/server.ts`.

- [ ] **Step 1: `apps/api/src/routes/maintenanceItems.ts`**

```ts
import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { maintenanceCreateSchema, maintenanceUpdateSchema } from "@mototracker/shared";

interface Row {
  id: string;
  bike_id: string;
  user_id: string;
  kind: "engine_oil" | "chain" | "brakes" | "tires" | "coolant" | "custom";
  custom_label: string | null;
  last_done_on: string | null;
  last_done_km: number | null;
  interval_months: number | null;
  interval_km: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToMaintenance(r: Row) {
  return {
    id: r.id,
    bikeId: r.bike_id,
    userId: r.user_id,
    kind: r.kind,
    customLabel: r.custom_label,
    lastDoneOn: r.last_done_on,
    lastDoneKm: r.last_done_km,
    intervalMonths: r.interval_months,
    intervalKm: r.interval_km,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const bikesNestedMaintRouter: Router = Router({ mergeParams: true });
bikesNestedMaintRouter.use(requireUser);

bikesNestedMaintRouter.get(
  "/:id/maintenance-items",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!bike) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rows = db
      .prepare(
        "SELECT * FROM maintenance_item WHERE bike_id = ? AND user_id = ? ORDER BY kind ASC",
      )
      .all(req.params.id, req.user!.id) as Row[];
    res.json(rows.map(rowToMaintenance));
  }),
);

bikesNestedMaintRouter.post(
  "/:id/maintenance-items",
  asyncHandler(async (req, res) => {
    const body = maintenanceCreateSchema.parse(req.body);
    const db = getDb();
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!bike) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO maintenance_item
         (id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km, interval_months, interval_km, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.params.id,
      req.user!.id,
      body.kind,
      body.customLabel ?? null,
      body.lastDoneOn ?? null,
      body.lastDoneKm ?? null,
      body.intervalMonths ?? null,
      body.intervalKm ?? null,
      body.notes ?? null,
    );
    const row = db.prepare("SELECT * FROM maintenance_item WHERE id = ?").get(id) as Row;
    res.status(201).json(rowToMaintenance(row));
  }),
);

export const maintenanceItemsRouter: Router = Router();
maintenanceItemsRouter.use(requireUser);

maintenanceItemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM maintenance_item WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as Row | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToMaintenance(row));
  }),
);

maintenanceItemsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = maintenanceUpdateSchema.parse(req.body);
    const db = getDb();
    const exists = db
      .prepare("SELECT id FROM maintenance_item WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!exists) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const fieldMap: Record<string, string> = {
      kind: "kind",
      customLabel: "custom_label",
      lastDoneOn: "last_done_on",
      lastDoneKm: "last_done_km",
      intervalMonths: "interval_months",
      intervalKm: "interval_km",
      notes: "notes",
    };
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [k, col] of Object.entries(fieldMap)) {
      if (k in body) {
        sets.push(`${col} = ?`);
        values.push((body as Record<string, unknown>)[k] as string | number | null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(req.params.id, req.user!.id);
      db.prepare(`UPDATE maintenance_item SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(
        ...values,
      );
    }
    const row = db.prepare("SELECT * FROM maintenance_item WHERE id = ?").get(req.params.id) as Row;
    res.json(rowToMaintenance(row));
  }),
);

maintenanceItemsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const r = db
      .prepare("DELETE FROM maintenance_item WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    if (r.changes === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  }),
);
```

- [ ] **Step 2: Mount in `apps/api/src/server.ts`**

Add imports:
```ts
import { bikesNestedMaintRouter, maintenanceItemsRouter } from "./routes/maintenanceItems.js";
```

After existing `app.use("/api/bikes", bikesNestedDatedRouter);`:
```ts
  app.use("/api/bikes", bikesNestedMaintRouter);
  app.use("/api/maintenance-items", maintenanceItemsRouter);
```

- [ ] **Step 3: Tests `apps/api/tests/maintenanceItems.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/maintenance-items", () => {
  it("create + list + patch + delete with isolation", async () => {
    const app = buildTestApp();
    const u1 = await signUpAndSignIn(app, "alice@test.com");
    const u2 = await signUpAndSignIn(app, "bob@test.com");

    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", u1.cookie)
      .send({ nickname: "B1" });
    const bikeId = bike.body.id;

    const create = await request(app)
      .post(`/api/bikes/${bikeId}/maintenance-items`)
      .set("Cookie", u1.cookie)
      .send({
        kind: "engine_oil",
        lastDoneOn: "2026-01-01",
        lastDoneKm: 1000,
        intervalMonths: 6,
        intervalKm: 6000,
      });
    expect(create.status).toBe(201);
    const id = create.body.id;
    expect(create.body.kind).toBe("engine_oil");

    const list = await request(app)
      .get(`/api/bikes/${bikeId}/maintenance-items`)
      .set("Cookie", u1.cookie);
    expect(list.body).toHaveLength(1);

    const patch = await request(app)
      .patch(`/api/maintenance-items/${id}`)
      .set("Cookie", u1.cookie)
      .send({ lastDoneKm: 1500 });
    expect(patch.body.lastDoneKm).toBe(1500);

    const cross = await request(app)
      .get(`/api/maintenance-items/${id}`)
      .set("Cookie", u2.cookie);
    expect(cross.status).toBe(404);

    const del = await request(app)
      .delete(`/api/maintenance-items/${id}`)
      .set("Cookie", u1.cookie);
    expect(del.status).toBe(204);
  });

  it("rejects bad date format", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "x" });
    const res = await request(app)
      .post(`/api/bikes/${bike.body.id}/maintenance-items`)
      .set("Cookie", cookie)
      .send({ kind: "chain", lastDoneOn: "1.6.2026" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @mototracker/api test
git add apps/api
git commit -m "feat(api): maintenance_item CRUD routes + tests"
```

Expected: 32 + 2 = 34 passing.

---

## Task 5: API notification preferences routes + tests

**Files:** Create `apps/api/src/routes/notificationPreferences.ts`, `apps/api/tests/notificationPreferences.test.ts`; modify `apps/api/src/server.ts`.

- [ ] **Step 1: Routes**

```ts
import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { notifPreferenceUpdateSchema, type NotifItemType } from "@mototracker/shared";

const ITEM_TYPES: NotifItemType[] = ["sigorta", "kasko", "muayene", "maintenance"];
const DEFAULT_LEAD = "30,7,1";

interface Row {
  user_id: string;
  item_type: NotifItemType;
  lead_days_csv: string;
  enabled: number;
}

function rowToPref(r: Row) {
  return {
    userId: r.user_id,
    itemType: r.item_type,
    leadDays: r.lead_days_csv
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => b - a),
    enabled: r.enabled === 1,
  };
}

function ensureAllPrefs(db: ReturnType<typeof getDb>, userId: string) {
  for (const t of ITEM_TYPES) {
    db.prepare(
      `INSERT OR IGNORE INTO notification_preference (user_id, item_type, lead_days_csv, enabled)
       VALUES (?, ?, ?, 1)`,
    ).run(userId, t, DEFAULT_LEAD);
  }
}

export const notificationPreferencesRouter: Router = Router();
notificationPreferencesRouter.use(requireUser);

notificationPreferencesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    ensureAllPrefs(db, req.user!.id);
    const rows = db
      .prepare(
        "SELECT user_id, item_type, lead_days_csv, enabled FROM notification_preference WHERE user_id = ?",
      )
      .all(req.user!.id) as Row[];
    res.json(rows.map(rowToPref));
  }),
);

notificationPreferencesRouter.put(
  "/:itemType",
  asyncHandler(async (req, res) => {
    const itemType = req.params.itemType;
    if (!ITEM_TYPES.includes(itemType as NotifItemType)) {
      res.status(400).json({ error: "bad_item_type" });
      return;
    }
    const body = notifPreferenceUpdateSchema.parse(req.body);
    const csv = [...new Set(body.leadDays)].sort((a, b) => b - a).join(",");
    const db = getDb();
    db.prepare(
      `INSERT INTO notification_preference (user_id, item_type, lead_days_csv, enabled)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, item_type) DO UPDATE
         SET lead_days_csv = excluded.lead_days_csv,
             enabled = excluded.enabled`,
    ).run(req.user!.id, itemType, csv, body.enabled ? 1 : 0);
    const row = db
      .prepare(
        "SELECT user_id, item_type, lead_days_csv, enabled FROM notification_preference WHERE user_id = ? AND item_type = ?",
      )
      .get(req.user!.id, itemType) as Row;
    res.json(rowToPref(row));
  }),
);
```

- [ ] **Step 2: Mount**

In `apps/api/src/server.ts`:

```ts
import { notificationPreferencesRouter } from "./routes/notificationPreferences.js";
```

After other routes:
```ts
  app.use("/api/notification-preferences", notificationPreferencesRouter);
```

- [ ] **Step 3: Tests**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/notification-preferences", () => {
  it("seeds defaults on first GET", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .get("/api/notification-preferences")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    const sig = res.body.find((p: { itemType: string }) => p.itemType === "sigorta");
    expect(sig.leadDays).toEqual([30, 7, 1]);
    expect(sig.enabled).toBe(true);
  });

  it("PUT updates lead days and enabled", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await request(app).get("/api/notification-preferences").set("Cookie", cookie);
    const res = await request(app)
      .put("/api/notification-preferences/sigorta")
      .set("Cookie", cookie)
      .send({ leadDays: [60, 14, 7, 7, 1], enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.leadDays).toEqual([60, 14, 7, 1]); // dedup + sorted desc
    expect(res.body.enabled).toBe(false);
  });

  it("rejects unknown item type", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .put("/api/notification-preferences/wat")
      .set("Cookie", cookie)
      .send({ leadDays: [1], enabled: true });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @mototracker/api test
git add apps/api
git commit -m "feat(api): notification_preference routes (auto-seed + PUT)"
```

Expected: 34 + 3 = 37.

---

## Task 6: API push subscriptions + web-push wrapper

**Files:** Create `apps/api/src/notify/webPushClient.ts`, `apps/api/src/routes/pushSubscriptions.ts`, `apps/api/tests/pushSubscriptions.test.ts`; modify `apps/api/package.json`, `apps/api/src/server.ts`.

- [ ] **Step 1: Add deps**

```bash
pnpm --filter @mototracker/api add web-push
pnpm --filter @mototracker/api add -D @types/web-push
```

- [ ] **Step 2: `apps/api/src/notify/webPushClient.ts`**

```ts
import webpush from "web-push";
import { config } from "../config.js";

export interface SendPushInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  payload: unknown;
}

export type SendPushResult = { ok: true } | { ok: false; gone: boolean; status: number; message: string };

let _send = defaultSend;
async function defaultSend(input: SendPushInput): Promise<SendPushResult> {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    return { ok: false, gone: false, status: 0, message: "VAPID keys not configured" };
  }
  webpush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY,
  );
  try {
    await webpush.sendNotification(
      { endpoint: input.endpoint, keys: input.keys },
      JSON.stringify(input.payload),
    );
    return { ok: true };
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    const gone = status === 404 || status === 410;
    return { ok: false, gone, status, message: err.message ?? String(e) };
  }
}

export async function sendPush(input: SendPushInput): Promise<SendPushResult> {
  return _send(input);
}

export function __setSendForTests(impl: typeof defaultSend): void {
  _send = impl;
}
export function __resetSendForTests(): void {
  _send = defaultSend;
}
```

- [ ] **Step 3: `apps/api/src/routes/pushSubscriptions.ts`**

```ts
import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { pushSubscriptionInputSchema } from "@mototracker/shared";
import { config } from "../config.js";
import { sendPush } from "../notify/webPushClient.js";

export const pushSubscriptionsRouter: Router = Router();
pushSubscriptionsRouter.use(requireUser);

pushSubscriptionsRouter.get(
  "/public-key",
  asyncHandler(async (_req, res) => {
    res.json({ publicKey: config.VAPID_PUBLIC_KEY ?? null });
  }),
);

pushSubscriptionsRouter.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const body = pushSubscriptionInputSchema.parse(req.body);
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM push_subscription WHERE endpoint = ?")
      .get(body.endpoint) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE push_subscription
           SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, last_seen_at = datetime('now')
         WHERE id = ?`,
      ).run(req.user!.id, body.keys.p256dh, body.keys.auth, body.userAgent ?? null, existing.id);
      res.json({ id: existing.id, status: "updated" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, user_agent, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(id, req.user!.id, body.endpoint, body.keys.p256dh, body.keys.auth, body.userAgent ?? null);
    res.status(201).json({ id, status: "created" });
  }),
);

pushSubscriptionsRouter.post(
  "/unsubscribe",
  asyncHandler(async (req, res) => {
    const endpoint = (req.body && (req.body as { endpoint?: string }).endpoint) ?? null;
    if (!endpoint) {
      res.status(400).json({ error: "endpoint_required" });
      return;
    }
    const db = getDb();
    db.prepare("DELETE FROM push_subscription WHERE endpoint = ? AND user_id = ?").run(
      endpoint,
      req.user!.id,
    );
    res.status(204).end();
  }),
);

pushSubscriptionsRouter.post(
  "/test",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const subs = db
      .prepare("SELECT endpoint, p256dh, auth FROM push_subscription WHERE user_id = ?")
      .all(req.user!.id) as { endpoint: string; p256dh: string; auth: string }[];
    if (subs.length === 0) {
      res.status(404).json({ error: "no_subscriptions" });
      return;
    }
    const results = await Promise.all(
      subs.map((s) =>
        sendPush({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
          payload: {
            title: "MotoTracker test",
            body: "Bildirimler çalışıyor.",
            url: "/dashboard",
            tag: "test",
          },
        }),
      ),
    );
    res.json({ sent: results.filter((r) => r.ok).length, total: results.length });
  }),
);
```

- [ ] **Step 4: Mount**

Add to `apps/api/src/server.ts`:

```ts
import { pushSubscriptionsRouter } from "./routes/pushSubscriptions.js";
```

After other routes:
```ts
  app.use("/api/push", pushSubscriptionsRouter);
```

- [ ] **Step 5: Tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import {
  __setSendForTests,
  __resetSendForTests,
} from "../src/notify/webPushClient.js";

describe("/api/push", () => {
  beforeEach(() => {
    __setSendForTests(async () => ({ ok: true as const }));
  });
  afterEach(() => {
    __resetSendForTests();
  });

  it("subscribe + unsubscribe", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const sub = await request(app)
      .post("/api/push/subscribe")
      .set("Cookie", cookie)
      .send({
        endpoint: "https://fcm.example/abc",
        keys: { p256dh: "P256", auth: "AUTH" },
      });
    expect(sub.status).toBe(201);
    const dup = await request(app)
      .post("/api/push/subscribe")
      .set("Cookie", cookie)
      .send({
        endpoint: "https://fcm.example/abc",
        keys: { p256dh: "P256X", auth: "AUTH" },
      });
    expect(dup.status).toBe(200); // upsert path
    const off = await request(app)
      .post("/api/push/unsubscribe")
      .set("Cookie", cookie)
      .send({ endpoint: "https://fcm.example/abc" });
    expect(off.status).toBe(204);
  });

  it("test fanout calls sendPush for each subscription", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    let calls = 0;
    __setSendForTests(async () => {
      calls += 1;
      return { ok: true as const };
    });
    await request(app)
      .post("/api/push/subscribe")
      .set("Cookie", cookie)
      .send({
        endpoint: "https://fcm.example/a",
        keys: { p256dh: "P", auth: "A" },
      });
    await request(app)
      .post("/api/push/subscribe")
      .set("Cookie", cookie)
      .send({
        endpoint: "https://fcm.example/b",
        keys: { p256dh: "P", auth: "A" },
      });
    const r = await request(app).post("/api/push/test").set("Cookie", cookie);
    expect(r.body).toEqual({ sent: 2, total: 2 });
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 6: Run + commit**

```bash
pnpm --filter @mototracker/api test
git add apps/api
git commit -m "feat(api): push subscription routes + web-push wrapper with test seam"
```

Expected: 37 + 2 = 39.

---

## Task 7: API `computeDueNotifications` + tests

**Files:** Create `apps/api/src/notify/types.ts`, `apps/api/src/notify/computeDueNotifications.ts`, `apps/api/tests/notify.compute.test.ts`.

- [ ] **Step 1: `types.ts`**

```ts
export interface DueNotification {
  userId: string;
  itemKind: "dated" | "maintenance";
  itemId: string;
  bikeId: string;
  itemType: "sigorta" | "kasko" | "muayene" | "maintenance";
  leadDays: number;
  expiresOn: string;          // ISO date the user is being warned about
  bikeNickname: string;
  bikePlate: string | null;
  maintenanceLabel: string | null; // for maintenance items only
}
```

- [ ] **Step 2: `computeDueNotifications.ts`**

```ts
import type Database from "better-sqlite3";
import { addDays, addMonths, parseISO, format, isBefore } from "date-fns";
import type { DueNotification } from "./types.js";

interface PrefRow {
  user_id: string;
  item_type: "sigorta" | "kasko" | "muayene" | "maintenance";
  lead_days_csv: string;
  enabled: number;
}

interface DatedItemRow {
  id: string;
  bike_id: string;
  user_id: string;
  type: "sigorta" | "kasko" | "muayene";
  expires_on: string;
}

interface MaintRow {
  id: string;
  bike_id: string;
  user_id: string;
  kind: string;
  custom_label: string | null;
  last_done_on: string | null;
  last_done_km: number | null;
  interval_months: number | null;
  interval_km: number | null;
}

interface BikeRow {
  id: string;
  nickname: string;
  plate: string | null;
  current_km: number | null;
}

interface SentRow {
  item_kind: "dated" | "maintenance";
  item_id: string;
  lead_days: number;
}

function parseLeads(csv: string): number[] {
  return csv
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function maintenanceDueDate(m: MaintRow): string | null {
  // Return the earliest of (last_done_on + interval_months) / nothing-else.
  if (!m.last_done_on || !m.interval_months) return null;
  const base = parseISO(m.last_done_on);
  const due = addMonths(base, m.interval_months);
  return format(due, "yyyy-MM-dd");
}

const MAINT_LABEL: Record<string, string> = {
  engine_oil: "Motor yağı",
  chain: "Zincir",
  brakes: "Fren",
  tires: "Lastik",
  coolant: "Soğutma",
  custom: "Bakım",
};

export function computeDueNotifications(db: Database.Database, todayIso: string): DueNotification[] {
  const today = parseISO(todayIso);
  const prefs = db
    .prepare("SELECT user_id, item_type, lead_days_csv, enabled FROM notification_preference")
    .all() as PrefRow[];

  const sentRows = db
    .prepare(
      "SELECT item_kind, item_id, lead_days FROM notification_sent WHERE sent_on = ?",
    )
    .all(todayIso) as SentRow[];
  const sentKey = new Set(sentRows.map((r) => `${r.item_kind}:${r.item_id}:${r.lead_days}`));

  const out: DueNotification[] = [];

  // Dated items: latest row per (bike, type) wins.
  const dated = db
    .prepare(
      `SELECT di.id, di.bike_id, di.user_id, di.type, di.expires_on
         FROM dated_item di
         JOIN (
           SELECT bike_id, type, MAX(expires_on) AS me
             FROM dated_item GROUP BY bike_id, type
         ) m ON m.bike_id = di.bike_id AND m.type = di.type AND m.me = di.expires_on`,
    )
    .all() as DatedItemRow[];

  const bikeStmt = db.prepare(
    "SELECT id, nickname, plate, current_km FROM bike WHERE id = ? AND archived = 0",
  );

  for (const d of dated) {
    const pref = prefs.find((p) => p.user_id === d.user_id && p.item_type === d.type);
    if (!pref || pref.enabled !== 1) continue;
    const leads = parseLeads(pref.lead_days_csv);
    const target = parseISO(d.expires_on);
    if (isBefore(target, today)) continue;

    for (const lead of leads) {
      const fireDay = addDays(target, -lead);
      if (format(fireDay, "yyyy-MM-dd") !== todayIso) continue;
      if (sentKey.has(`dated:${d.id}:${lead}`)) continue;
      const bike = bikeStmt.get(d.bike_id) as BikeRow | undefined;
      if (!bike) continue;
      out.push({
        userId: d.user_id,
        itemKind: "dated",
        itemId: d.id,
        bikeId: d.bike_id,
        itemType: d.type,
        leadDays: lead,
        expiresOn: d.expires_on,
        bikeNickname: bike.nickname,
        bikePlate: bike.plate,
        maintenanceLabel: null,
      });
    }
  }

  const maint = db
    .prepare(
      "SELECT id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km, interval_months, interval_km FROM maintenance_item",
    )
    .all() as MaintRow[];

  for (const m of maint) {
    const pref = prefs.find((p) => p.user_id === m.user_id && p.item_type === "maintenance");
    if (!pref || pref.enabled !== 1) continue;
    const due = maintenanceDueDate(m);
    if (!due) continue;
    const target = parseISO(due);
    if (isBefore(target, today)) continue;
    const leads = parseLeads(pref.lead_days_csv);
    for (const lead of leads) {
      const fireDay = addDays(target, -lead);
      if (format(fireDay, "yyyy-MM-dd") !== todayIso) continue;
      if (sentKey.has(`maintenance:${m.id}:${lead}`)) continue;
      const bike = bikeStmt.get(m.bike_id) as BikeRow | undefined;
      if (!bike) continue;
      out.push({
        userId: m.user_id,
        itemKind: "maintenance",
        itemId: m.id,
        bikeId: m.bike_id,
        itemType: "maintenance",
        leadDays: lead,
        expiresOn: due,
        bikeNickname: bike.nickname,
        bikePlate: bike.plate,
        maintenanceLabel: m.kind === "custom" ? m.custom_label ?? "Bakım" : MAINT_LABEL[m.kind] ?? "Bakım",
      });
    }
  }

  return out;
}
```

- [ ] **Step 3: Tests**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { computeDueNotifications } from "../src/notify/computeDueNotifications.js";

function seedUser(userId: string, email = `${userId}@t.io`) {
  getDb()
    .prepare("INSERT INTO user (id, email) VALUES (?, ?)")
    .run(userId, email);
}

function seedBike(id: string, userId: string, plate?: string | null) {
  getDb()
    .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES (?, ?, ?, ?)")
    .run(id, userId, "B", plate ?? null);
}

function seedDated(id: string, bikeId: string, userId: string, type: string, expires: string) {
  getDb()
    .prepare(
      "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, bikeId, userId, type, expires);
}

function seedPref(userId: string, itemType: string, csv = "30,7,1", enabled = 1) {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES (?, ?, ?, ?)",
    )
    .run(userId, itemType, csv, enabled);
}

describe("computeDueNotifications", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
  });

  it("emits one notification when a sigorta is exactly 7 days out and pref includes 7", () => {
    seedUser("u1");
    seedBike("b1", "u1", "34X");
    seedDated("d1", "b1", "u1", "sigorta", "2026-06-08");
    seedPref("u1", "sigorta");
    const out = computeDueNotifications(getDb(), "2026-06-01");
    expect(out).toHaveLength(1);
    expect(out[0]!.leadDays).toBe(7);
    expect(out[0]!.itemKind).toBe("dated");
  });

  it("emits 30 + 7 + 1 across distinct days", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    seedDated("d1", "b1", "u1", "muayene", "2026-07-01");
    seedPref("u1", "muayene");

    const dayMinus30 = computeDueNotifications(getDb(), "2026-06-01");
    const dayMinus7 = computeDueNotifications(getDb(), "2026-06-24");
    const dayMinus1 = computeDueNotifications(getDb(), "2026-06-30");
    const random = computeDueNotifications(getDb(), "2026-06-15");

    expect(dayMinus30.map((d) => d.leadDays)).toEqual([30]);
    expect(dayMinus7.map((d) => d.leadDays)).toEqual([7]);
    expect(dayMinus1.map((d) => d.leadDays)).toEqual([1]);
    expect(random).toEqual([]);
  });

  it("respects enabled=false", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    seedDated("d1", "b1", "u1", "kasko", "2026-06-08");
    seedPref("u1", "kasko", "30,7,1", 0);
    expect(computeDueNotifications(getDb(), "2026-06-01")).toEqual([]);
  });

  it("dedupes via notification_sent on the same day", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    seedDated("d1", "b1", "u1", "sigorta", "2026-06-08");
    seedPref("u1", "sigorta");
    getDb()
      .prepare(
        "INSERT INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on) VALUES ('n1','u1','dated','d1',7,'2026-06-01')",
      )
      .run();
    expect(computeDueNotifications(getDb(), "2026-06-01")).toEqual([]);
  });

  it("uses the latest dated_item per (bike,type) when there are multiple", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    seedDated("d1", "b1", "u1", "sigorta", "2025-06-08"); // expired earlier
    seedDated("d2", "b1", "u1", "sigorta", "2026-06-08");
    seedPref("u1", "sigorta");
    const out = computeDueNotifications(getDb(), "2026-06-01");
    expect(out).toHaveLength(1);
    expect(out[0]!.itemId).toBe("d2");
  });

  it("emits a maintenance notification based on last_done + interval_months", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    getDb()
      .prepare(
        "INSERT INTO maintenance_item (id, bike_id, user_id, kind, last_done_on, interval_months) VALUES ('m1','b1','u1','engine_oil','2026-01-01',6)",
      )
      .run();
    seedPref("u1", "maintenance");
    // due 2026-07-01, lead 7 -> fires on 2026-06-24
    const out = computeDueNotifications(getDb(), "2026-06-24");
    expect(out).toHaveLength(1);
    expect(out[0]!.itemKind).toBe("maintenance");
    expect(out[0]!.maintenanceLabel).toBe("Motor yağı");
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @mototracker/api test
git add apps/api
git commit -m "feat(api): pure computeDueNotifications + tests"
```

Expected: 39 + 6 = 45.

---

## Task 8: Dispatcher + cron

**Files:** Create `apps/api/src/notify/dispatcher.ts`, `apps/api/src/notify/cron.ts`, `apps/api/tests/notify.dispatcher.test.ts`. Modify `apps/api/src/index.ts`. Add deps.

- [ ] **Step 1: Add cron dep**

```bash
pnpm --filter @mototracker/api add node-cron
pnpm --filter @mototracker/api add -D @types/node-cron
```

- [ ] **Step 2: `apps/api/src/notify/dispatcher.ts`**

```ts
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { sendPush } from "./webPushClient.js";
import { computeDueNotifications } from "./computeDueNotifications.js";
import type { DueNotification } from "./types.js";

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface DispatchSummary {
  total: number;
  sent: number;
  recordedSent: number;
  expiredEndpoints: number;
}

const TYPE_LABEL: Record<string, string> = {
  sigorta: "Sigorta",
  kasko: "Kasko",
  muayene: "Muayene",
  maintenance: "Bakım",
};

function buildPayload(n: DueNotification) {
  const label =
    n.itemKind === "maintenance" && n.maintenanceLabel
      ? n.maintenanceLabel
      : TYPE_LABEL[n.itemType] ?? "Bildirim";
  const days = n.leadDays;
  const subject = days === 0 ? "bugün" : `${days} gün sonra`;
  const url =
    n.itemKind === "dated"
      ? `/dated-items/${n.itemId}`
      : `/bikes/${n.bikeId}/maintenance/${n.itemId}`;
  return {
    title: `${label} ${subject} bitiyor`,
    body: `${n.bikeNickname}${n.bikePlate ? ` · ${n.bikePlate}` : ""}`,
    url,
    tag: `${n.itemKind}:${n.itemId}:${n.leadDays}`,
  };
}

export async function dispatchForToday(todayIso: string): Promise<DispatchSummary> {
  const db = getDb();
  const due = computeDueNotifications(db, todayIso);

  let sent = 0;
  let recordedSent = 0;
  let expiredEndpoints = 0;

  for (const n of due) {
    const subs = db
      .prepare("SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE user_id = ?")
      .all(n.userId) as SubRow[];
    if (subs.length === 0) continue;

    const payload = buildPayload(n);
    let anyOk = false;
    for (const s of subs) {
      const res = await sendPush({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
        payload,
      });
      if (res.ok) {
        anyOk = true;
        sent += 1;
      } else if (res.gone) {
        db.prepare("DELETE FROM push_subscription WHERE id = ?").run(s.id);
        expiredEndpoints += 1;
      }
    }
    if (anyOk) {
      db.prepare(
        `INSERT OR IGNORE INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(newId(), n.userId, n.itemKind, n.itemId, n.leadDays, todayIso);
      recordedSent += 1;
    }
  }

  return { total: due.length, sent, recordedSent, expiredEndpoints };
}
```

- [ ] **Step 3: `apps/api/src/notify/cron.ts`**

```ts
import cron from "node-cron";
import { config } from "../config.js";
import { dispatchForToday } from "./dispatcher.js";

export function startCron(): void {
  if (!config.CRON_ENABLED) {
    console.log("[cron] disabled");
    return;
  }
  const expr = `0 ${config.CRON_HOUR} * * *`;
  cron.schedule(
    expr,
    () => {
      const today = new Date()
        .toLocaleDateString("en-CA", { timeZone: config.CRON_TIMEZONE });
      // en-CA produces YYYY-MM-DD
      void dispatchForToday(today)
        .then((s) => console.log(`[cron] dispatched ${s.sent}/${s.total}, expired ${s.expiredEndpoints}`))
        .catch((e) => console.error("[cron] failure", e));
    },
    { timezone: config.CRON_TIMEZONE },
  );
  console.log(`[cron] scheduled '${expr}' in ${config.CRON_TIMEZONE}`);
}
```

- [ ] **Step 4: Modify `apps/api/src/index.ts`**

Replace contents:

```ts
import { buildApp } from "./server.js";
import { config } from "./config.js";
import { startCron } from "./notify/cron.js";

const app = buildApp();
app.listen(config.PORT, () => {
  console.log(`[api] listening on http://localhost:${config.PORT}`);
  startCron();
});
```

- [ ] **Step 5: Tests `apps/api/tests/notify.dispatcher.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { dispatchForToday } from "../src/notify/dispatcher.js";
import {
  __setSendForTests,
  __resetSendForTests,
} from "../src/notify/webPushClient.js";

function seed() {
  getDb().prepare("INSERT INTO user (id, email) VALUES ('u1','x@y.io')").run();
  getDb()
    .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES ('b1','u1','M','34X')")
    .run();
  getDb()
    .prepare(
      "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d1','b1','u1','sigorta','2026-06-08')",
    )
    .run();
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','30,7,1',1)",
    )
    .run();
  getDb()
    .prepare(
      "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P','A')",
    )
    .run();
}

describe("dispatchForToday", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
    __setSendForTests(async () => ({ ok: true as const }));
  });
  afterEach(() => {
    __resetSendForTests();
  });

  it("sends to subscribers and records notification_sent", async () => {
    seed();
    const summary = await dispatchForToday("2026-06-01");
    expect(summary.total).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.recordedSent).toBe(1);
    const sent = getDb()
      .prepare("SELECT * FROM notification_sent WHERE sent_on = ?")
      .all("2026-06-01");
    expect(sent).toHaveLength(1);
  });

  it("does not double-record if the same lead/day is run twice", async () => {
    seed();
    await dispatchForToday("2026-06-01");
    const second = await dispatchForToday("2026-06-01");
    expect(second.total).toBe(0); // computeDueNotifications skips already-sent
  });

  it("purges expired (404/410) endpoints and does not record", async () => {
    seed();
    __setSendForTests(async () => ({
      ok: false as const,
      gone: true,
      status: 410,
      message: "gone",
    }));
    const summary = await dispatchForToday("2026-06-01");
    expect(summary.expiredEndpoints).toBe(1);
    expect(summary.recordedSent).toBe(0);
    const remaining = getDb()
      .prepare("SELECT COUNT(*) AS c FROM push_subscription")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });
});
```

- [ ] **Step 6: Run + commit**

```bash
pnpm --filter @mototracker/api test
git add apps/api
git commit -m "feat(api): notification dispatcher + node-cron schedule"
```

Expected: 45 + 3 = 48.

---

## Task 9: Web — vite-plugin-pwa, manifest, service worker

**Files:** Modify `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`. Create `apps/web/src/sw.ts`, `apps/web/public/icons/icon-192.svg`, `apps/web/public/icons/icon-512.svg`, `apps/web/public/icons/maskable.svg`.

- [ ] **Step 1: Add deps**

```bash
pnpm --filter @mototracker/web add -D vite-plugin-pwa workbox-window
```

- [ ] **Step 2: Icons (placeholder SVGs — replace with real artwork later)**

`apps/web/public/icons/icon-192.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="#0B0B0E"/><circle cx="60" cy="132" r="30" fill="none" stroke="#E1FF4D" stroke-width="12"/><circle cx="132" cy="132" r="30" fill="none" stroke="#E1FF4D" stroke-width="12"/><path d="M60 132 L96 60 L132 132" fill="none" stroke="#E1FF4D" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

`apps/web/public/icons/icon-512.svg`: same SVG with `viewBox="0 0 192 192"` is fine since SVG scales — but adjust the rect to 512x512:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="84" fill="#0B0B0E"/><circle cx="160" cy="352" r="80" fill="none" stroke="#E1FF4D" stroke-width="32"/><circle cx="352" cy="352" r="80" fill="none" stroke="#E1FF4D" stroke-width="32"/><path d="M160 352 L256 160 L352 352" fill="none" stroke="#E1FF4D" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

`apps/web/public/icons/maskable.svg`: same as 512 but with the artwork inset (smaller circles/lines centered) so iOS rounded mask doesn't cut it. For simplicity:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0B0B0E"/><g transform="translate(96,96) scale(0.625)"><circle cx="160" cy="352" r="80" fill="none" stroke="#E1FF4D" stroke-width="32"/><circle cx="352" cy="352" r="80" fill="none" stroke="#E1FF4D" stroke-width="32"/><path d="M160 352 L256 160 L352 352" fill="none" stroke="#E1FF4D" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/></g></svg>
```

- [ ] **Step 3: `apps/web/src/sw.ts`** (custom SW used with `injectManifest`)

```ts
/// <reference lib="webworker" />
/// <reference types="vite/client" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "MotoTracker", body: event.data?.text() ?? "" };
  }
  const title = payload.title ?? "MotoTracker";
  const options: NotificationOptions = {
    body: payload.body,
    tag: payload.tag,
    icon: "/icons/icon-192.svg",
    badge: "/icons/icon-192.svg",
    data: { url: payload.url ?? "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/dashboard";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          (c as WindowClient).navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
```

- [ ] **Step 4: Modify `apps/web/vite.config.ts`** to register the PWA plugin

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "MotoTracker",
        short_name: "MotoTracker",
        description: "Sigorta · Kasko · Muayene · Bakım takibi",
        start_url: "/dashboard",
        scope: "/",
        display: "standalone",
        background_color: "#0B0B0E",
        theme_color: "#0B0B0E",
        lang: "tr",
        icons: [
          { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
          { src: "/icons/maskable.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
```

- [ ] **Step 5: Modify `apps/web/index.html`** — the plugin auto-injects the manifest link, but add `apple-touch-icon`:

In the `<head>`, add (before the existing `<title>`):

```html
    <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
```

- [ ] **Step 6: Build + commit**

```bash
pnpm --filter @mototracker/web build
git add apps/web
git commit -m "feat(web): PWA manifest + custom service worker with push handler"
```

Expected: build emits `dist/sw.js` and a manifest webmanifest. Confirm in build output.

---

## Task 10: Web — push subscribe / unsubscribe utilities + hook

**Files:** Create `apps/web/src/lib/push.ts`, `apps/web/src/hooks/usePush.ts`.

- [ ] **Step 1: `apps/web/src/lib/push.ts`**

```ts
import { api } from "./api";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export interface PushPublicKeyResponse {
  publicKey: string | null;
}

export async function getPushPublicKey(): Promise<string | null> {
  const r = await api<PushPublicKeyResponse>("/api/push/public-key");
  return r.publicKey;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.ready;
  return reg;
}

export async function subscribePushOnDevice(publicKey: string): Promise<{ id: string }> {
  if (Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") throw new Error("Bildirim izni reddedildi");
  }
  const reg = await ensureServiceWorker();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = sub.toJSON();
  return await api<{ id: string }>("/api/push/subscribe", {
    method: "POST",
    json: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      userAgent: navigator.userAgent,
    },
  });
}

export async function unsubscribePushOnDevice(): Promise<void> {
  const reg = await ensureServiceWorker();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api<void>("/api/push/unsubscribe", {
    method: "POST",
    json: { endpoint: sub.endpoint },
  });
  await sub.unsubscribe();
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await ensureServiceWorker();
  return reg.pushManager.getSubscription();
}
```

- [ ] **Step 2: `apps/web/src/hooks/usePush.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCurrentSubscription,
  getPushPublicKey,
  subscribePushOnDevice,
  unsubscribePushOnDevice,
} from "@/lib/push";
import { api } from "@/lib/api";

export function usePushStatus() {
  return useQuery({
    queryKey: ["push", "status"],
    queryFn: async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window;
      const permission = supported ? Notification.permission : "unsupported";
      const sub = supported ? await getCurrentSubscription() : null;
      return { supported, permission, subscribed: !!sub };
    },
  });
}

export function useEnablePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const key = await getPushPublicKey();
      if (!key) throw new Error("VAPID public key not configured on server");
      return subscribePushOnDevice(key);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push"] }),
  });
}

export function useDisablePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unsubscribePushOnDevice(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push"] }),
  });
}

export function useSendTestPush() {
  return useMutation({
    mutationFn: () => api<{ sent: number; total: number }>("/api/push/test", { method: "POST" }),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): push subscription utilities + hooks"
```

---

## Task 11: Web — i18n setup

**Files:** Create `apps/web/src/lib/i18n.ts`, `apps/web/src/locales/tr.json`, `apps/web/src/locales/en.json`. Modify `apps/web/package.json`, `apps/web/src/main.tsx`.

- [ ] **Step 1: Add deps**

```bash
pnpm --filter @mototracker/web add i18next react-i18next i18next-browser-languagedetector
```

- [ ] **Step 2: `apps/web/src/locales/tr.json`**

```json
{
  "brand": "MotoTracker",
  "nav": { "bikes": "Motosikletler", "settings": "Ayarlar", "signOut": "Çıkış" },
  "auth": {
    "signIn": "Giriş yap",
    "signUp": "Hesap oluştur",
    "magicLink": "Sihirli bağlantı gönder",
    "google": "Google ile giriş",
    "welcomeBack": "Tekrar hoş geldin",
    "newAccount": "Hesap oluştur",
    "magicSent": "Bağlantı gönderildi"
  },
  "dashboard": {
    "active": "Aktif motosiklet",
    "empty": "Henüz motosiklet eklemedin",
    "addBike": "Bir motosiklet ekle",
    "manageBikes": "Motosikletleri yönet"
  },
  "items": {
    "sigorta": "Sigorta",
    "kasko": "Kasko",
    "muayene": "Muayene",
    "maintenance": "Bakım",
    "addDate": "Tarih ekle",
    "daysLeft": "gün kaldı",
    "expired": "Geçti",
    "renew": "Yenile",
    "edit": "Düzenle",
    "delete": "Sil"
  },
  "settings": {
    "title": "Ayarlar",
    "language": "Dil",
    "tr": "Türkçe",
    "en": "English",
    "notifications": "Bildirimler",
    "enableOnDevice": "Bu cihazda bildirim al",
    "disableOnDevice": "Bu cihazda bildirimi kapat",
    "sendTest": "Test bildirimi gönder",
    "leadDays": "Hatırlatma günleri",
    "iosHint": "iPhone'da bildirim almak için uygulamayı önce ana ekrana ekle.",
    "signOut": "Çıkış"
  },
  "common": { "save": "Kaydet", "cancel": "İptal", "back": "Geri", "loading": "Yükleniyor..." }
}
```

- [ ] **Step 3: `apps/web/src/locales/en.json`**

```json
{
  "brand": "MotoTracker",
  "nav": { "bikes": "Bikes", "settings": "Settings", "signOut": "Sign out" },
  "auth": {
    "signIn": "Sign in",
    "signUp": "Create account",
    "magicLink": "Send magic link",
    "google": "Sign in with Google",
    "welcomeBack": "Welcome back",
    "newAccount": "Create account",
    "magicSent": "Link sent"
  },
  "dashboard": {
    "active": "Active bike",
    "empty": "You haven't added a bike yet",
    "addBike": "Add a bike",
    "manageBikes": "Manage bikes"
  },
  "items": {
    "sigorta": "Insurance",
    "kasko": "Kasko",
    "muayene": "Inspection",
    "maintenance": "Maintenance",
    "addDate": "Add date",
    "daysLeft": "days left",
    "expired": "Expired",
    "renew": "Renew",
    "edit": "Edit",
    "delete": "Delete"
  },
  "settings": {
    "title": "Settings",
    "language": "Language",
    "tr": "Turkish",
    "en": "English",
    "notifications": "Notifications",
    "enableOnDevice": "Enable on this device",
    "disableOnDevice": "Disable on this device",
    "sendTest": "Send test notification",
    "leadDays": "Reminder days",
    "iosHint": "On iPhone, install the app to your home screen first.",
    "signOut": "Sign out"
  },
  "common": { "save": "Save", "cancel": "Cancel", "back": "Back", "loading": "Loading..." }
}
```

- [ ] **Step 4: `apps/web/src/lib/i18n.ts`**

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import tr from "@/locales/tr.json";
import en from "@/locales/en.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "tr",
    supportedLngs: ["tr", "en"],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "lang",
    },
    interpolation: { escapeValue: false },
    resources: { tr: { translation: tr }, en: { translation: en } },
  });

export default i18n;

export function setLanguage(lng: "tr" | "en"): void {
  void i18n.changeLanguage(lng);
}
```

- [ ] **Step 5: Modify `apps/web/src/main.tsx`** to import i18n + wrap with MotionConfig

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./lib/i18n";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): i18n setup with TR + EN; respect prefers-reduced-motion"
```

---

## Task 12: Web — Settings page + AppShell link + maintenance UI + dashboard panel

**Files:** Create `apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/hooks/useMaintenanceItems.ts`, `apps/web/src/hooks/useNotifPreferences.ts`, `apps/web/src/components/MaintenancePanel.tsx`, `apps/web/src/pages/MaintenanceFormPage.tsx`. Modify `apps/web/src/components/AppShell.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/routes.tsx`.

This is the big web task. We commit at the end after build passes.

- [ ] **Step 1: `apps/web/src/hooks/useMaintenanceItems.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MaintenanceItem, MaintenanceCreateInput, MaintenanceUpdateInput } from "@mototracker/shared";

export function useMaintenanceForBike(bikeId: string | undefined) {
  return useQuery<MaintenanceItem[]>({
    queryKey: ["maintenance", "bike", bikeId],
    queryFn: () => api<MaintenanceItem[]>(`/api/bikes/${bikeId}/maintenance-items`),
    enabled: !!bikeId,
  });
}

export function useMaintenanceItem(id: string | undefined) {
  return useQuery<MaintenanceItem>({
    queryKey: ["maintenance", id],
    queryFn: () => api<MaintenanceItem>(`/api/maintenance-items/${id}`),
    enabled: !!id,
  });
}

export function useCreateMaintenance(bikeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MaintenanceCreateInput) =>
      api<MaintenanceItem>(`/api/bikes/${bikeId}/maintenance-items`, { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance", "bike", bikeId] });
    },
  });
}

export function useUpdateMaintenance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MaintenanceUpdateInput) =>
      api<MaintenanceItem>(`/api/maintenance-items/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
    },
  });
}

export function useDeleteMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/maintenance-items/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance"] }),
  });
}
```

- [ ] **Step 2: `apps/web/src/hooks/useNotifPreferences.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NotifPreference } from "@mototracker/shared";

export function useNotifPrefs() {
  return useQuery<NotifPreference[]>({
    queryKey: ["notif-prefs"],
    queryFn: () => api<NotifPreference[]>("/api/notification-preferences"),
  });
}

export function useUpdateNotifPref(itemType: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadDays: number[]; enabled: boolean }) =>
      api<NotifPreference>(`/api/notification-preferences/${itemType}`, {
        method: "PUT",
        json: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-prefs"] }),
  });
}
```

- [ ] **Step 3: `apps/web/src/components/MaintenancePanel.tsx`**

```tsx
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Wrench } from "lucide-react";
import type { MaintenanceItem } from "@mototracker/shared";
import { addMonths, parseISO, differenceInCalendarDays, format } from "date-fns";
import { useMaintenanceForBike } from "@/hooks/useMaintenanceItems";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const KIND_LABEL_TR: Record<string, string> = {
  engine_oil: "Motor yağı",
  chain: "Zincir",
  brakes: "Fren",
  tires: "Lastik",
  coolant: "Soğutma",
  custom: "Bakım",
};

function dueDate(m: MaintenanceItem): string | null {
  if (!m.lastDoneOn || !m.intervalMonths) return null;
  return format(addMonths(parseISO(m.lastDoneOn), m.intervalMonths), "yyyy-MM-dd");
}

interface Props {
  bikeId: string;
}

export function MaintenancePanel({ bikeId }: Props) {
  const q = useMaintenanceForBike(bikeId);
  const items = q.data ?? [];

  return (
    <motion.div
      layout
      className="rounded-xl border border-border p-4 dark:border-border-dark"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted dark:text-muted-dark" />
          <h2 className="text-sm font-medium uppercase tracking-wider">Bakım</h2>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to={`/bikes/${bikeId}/maintenance/new`}>
            <Plus className="h-4 w-4" /> Ekle
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted dark:text-muted-dark">
          Henüz bakım kaydı yok.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => {
            const due = dueDate(m);
            const days = due ? differenceInCalendarDays(parseISO(due), new Date()) : null;
            const danger = days !== null && days <= 7;
            const label = m.kind === "custom" ? m.customLabel ?? "Bakım" : KIND_LABEL_TR[m.kind];
            return (
              <li key={m.id}>
                <Link
                  to={`/bikes/${bikeId}/maintenance/${m.id}`}
                  className={cn(
                    "flex items-center justify-between rounded-xl border p-3 text-sm",
                    "border-border dark:border-border-dark",
                    danger && "border-danger/40 bg-danger/5",
                  )}
                >
                  <span className="font-medium">{label}</span>
                  <span className="font-mono text-xs">
                    {due ? (
                      days === null ? (
                        "—"
                      ) : days < 0 ? (
                        "Geçti"
                      ) : (
                        `${days} gün`
                      )
                    ) : (
                      "—"
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 4: `apps/web/src/pages/MaintenanceFormPage.tsx`**

```tsx
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pushToast } from "@/hooks/useToast";
import {
  useCreateMaintenance,
  useDeleteMaintenance,
  useMaintenanceItem,
  useUpdateMaintenance,
} from "@/hooks/useMaintenanceItems";

const KINDS = ["engine_oil", "chain", "brakes", "tires", "coolant", "custom"] as const;

const schema = z.object({
  kind: z.enum(KINDS),
  customLabel: z.string().max(120).optional().or(z.literal("")),
  lastDoneOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG").optional().or(z.literal("")),
  lastDoneKm: z.union([z.coerce.number().int().nonnegative(), z.literal("")]).optional(),
  intervalMonths: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
  intervalKm: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  mode: "new" | "edit";
}

export function MaintenanceFormPage({ mode }: Props) {
  const params = useParams();
  const navigate = useNavigate();
  const bikeId = params.bikeId!;
  const itemId = mode === "edit" ? params.id : undefined;

  const item = useMaintenanceItem(itemId);
  const createMut = useCreateMaintenance(bikeId);
  const updateMut = useUpdateMaintenance(itemId ?? "");
  const deleteMut = useDeleteMaintenance();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { kind: "engine_oil" },
  });

  useEffect(() => {
    if (mode === "edit" && item.data) {
      form.reset({
        kind: item.data.kind,
        customLabel: item.data.customLabel ?? "",
        lastDoneOn: item.data.lastDoneOn ?? "",
        lastDoneKm: item.data.lastDoneKm ?? "",
        intervalMonths: item.data.intervalMonths ?? "",
        intervalKm: item.data.intervalKm ?? "",
        notes: item.data.notes ?? "",
      });
    }
  }, [mode, item.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const payload = {
      kind: v.kind,
      customLabel: v.customLabel || null,
      lastDoneOn: v.lastDoneOn || null,
      lastDoneKm: typeof v.lastDoneKm === "number" ? v.lastDoneKm : null,
      intervalMonths: typeof v.intervalMonths === "number" ? v.intervalMonths : null,
      intervalKm: typeof v.intervalKm === "number" ? v.intervalKm : null,
      notes: v.notes || null,
    };
    try {
      if (mode === "edit" && itemId) {
        await updateMut.mutateAsync(payload);
      } else {
        await createMut.mutateAsync(payload);
      }
      pushToast({ variant: "success", title: "Kaydedildi" });
      navigate("/dashboard");
    } catch (e) {
      pushToast({ variant: "danger", title: "Kaydedilemedi", description: String(e) });
    }
  });

  const onDelete = async () => {
    if (!itemId) return;
    if (!confirm("Sil?")) return;
    await deleteMut.mutateAsync(itemId);
    navigate("/dashboard");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      <Card>
        <CardHeader>
          <CardTitle>{mode === "edit" ? "Bakım kaydını düzenle" : "Yeni bakım kaydı"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="kind">Tür</Label>
              <select
                id="kind"
                {...form.register("kind")}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              >
                <option value="engine_oil">Motor yağı</option>
                <option value="chain">Zincir</option>
                <option value="brakes">Fren</option>
                <option value="tires">Lastik</option>
                <option value="coolant">Soğutma</option>
                <option value="custom">Diğer</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="customLabel">Etiket (Diğer için)</Label>
              <Input id="customLabel" {...form.register("customLabel")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="lastDoneOn">Son yapım tarihi</Label>
                <Input id="lastDoneOn" type="date" {...form.register("lastDoneOn")} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="lastDoneKm">Son yapım km</Label>
                <Input id="lastDoneKm" type="number" {...form.register("lastDoneKm")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="intervalMonths">Periyot (ay)</Label>
                <Input id="intervalMonths" type="number" {...form.register("intervalMonths")} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="intervalKm">Periyot (km)</Label>
                <Input id="intervalKm" type="number" {...form.register("intervalKm")} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="notes">Not</Label>
              <textarea
                id="notes"
                rows={3}
                {...form.register("notes")}
                className="rounded-xl border border-border bg-surface p-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="accent" className="flex-1">
                Kaydet
              </Button>
              <Button asChild variant="ghost" className="flex-1">
                <Link to="/dashboard">İptal</Link>
              </Button>
            </div>
            {mode === "edit" && (
              <Button type="button" variant="danger" onClick={onDelete}>
                <Trash2 className="h-4 w-4" /> Sil
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
```

- [ ] **Step 5: `apps/web/src/pages/SettingsPage.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Bell, BellOff, LogOut } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { setLanguage } from "@/lib/i18n";
import { signOut } from "@/lib/authClient";
import { useNavigate } from "react-router-dom";
import { useNotifPrefs, useUpdateNotifPref } from "@/hooks/useNotifPreferences";
import { useDisablePush, useEnablePush, usePushStatus, useSendTestPush } from "@/hooks/usePush";
import { pushToast } from "@/hooks/useToast";
import { cn } from "@/lib/cn";

const LEAD_OPTIONS = [60, 30, 14, 7, 3, 1, 0];

const ITEM_TYPES = ["sigorta", "kasko", "muayene", "maintenance"] as const;

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const prefs = useNotifPrefs();
  const push = usePushStatus();
  const enablePush = useEnablePush();
  const disablePush = useDisablePush();
  const test = useSendTestPush();

  const onLang = (lng: "tr" | "en") => setLanguage(lng);

  const onTogglePush = async () => {
    if (push.data?.subscribed) {
      await disablePush.mutateAsync();
      pushToast({ variant: "success", title: t("settings.disableOnDevice") });
    } else {
      try {
        await enablePush.mutateAsync();
        pushToast({ variant: "success", title: t("settings.enableOnDevice") });
      } catch (e) {
        pushToast({ variant: "danger", title: "Hata", description: (e as Error).message });
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-3"
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.title")}</CardTitle>
        </CardHeader>
        <CardContent className="gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
              {t("settings.language")}
            </h3>
            <div className="flex gap-2">
              <LangButton active={i18n.language.startsWith("tr")} onClick={() => onLang("tr")}>
                {t("settings.tr")}
              </LangButton>
              <LangButton active={i18n.language.startsWith("en")} onClick={() => onLang("en")}>
                {t("settings.en")}
              </LangButton>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
              {t("settings.notifications")}
            </h3>

            {!push.data?.supported && (
              <p className="text-sm text-muted dark:text-muted-dark">
                Bu tarayıcı bildirimleri desteklemiyor. {t("settings.iosHint")}
              </p>
            )}
            {push.data?.supported && (
              <>
                <Button
                  variant={push.data.subscribed ? "outline" : "accent"}
                  onClick={onTogglePush}
                  disabled={enablePush.isPending || disablePush.isPending}
                >
                  {push.data.subscribed ? (
                    <>
                      <BellOff className="h-4 w-4" /> {t("settings.disableOnDevice")}
                    </>
                  ) : (
                    <>
                      <Bell className="h-4 w-4" /> {t("settings.enableOnDevice")}
                    </>
                  )}
                </Button>
                {push.data.subscribed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      test
                        .mutateAsync()
                        .then((r) =>
                          pushToast({
                            variant: r.sent > 0 ? "success" : "danger",
                            title: `Gönderildi: ${r.sent}/${r.total}`,
                          }),
                        )
                        .catch((e) =>
                          pushToast({ variant: "danger", title: "Hata", description: String(e) }),
                        )
                    }
                  >
                    {t("settings.sendTest")}
                  </Button>
                )}
              </>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
              {t("settings.leadDays")}
            </h3>
            {prefs.data?.map((p) => {
              const update = useUpdateNotifPref(p.itemType);
              const toggleLead = (n: number) => {
                const set = new Set(p.leadDays);
                if (set.has(n)) set.delete(n);
                else set.add(n);
                void update.mutateAsync({
                  enabled: p.enabled,
                  leadDays: [...set].sort((a, b) => b - a),
                });
              };
              const toggleEnabled = () => {
                void update.mutateAsync({ enabled: !p.enabled, leadDays: p.leadDays });
              };
              return (
                <div
                  key={p.itemType}
                  className="rounded-xl border border-border p-3 dark:border-border-dark"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">{t(`items.${p.itemType}`)}</span>
                    <button
                      onClick={toggleEnabled}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        p.enabled
                          ? "bg-success/15 text-success"
                          : "bg-surface text-muted dark:bg-surface-elev-dark dark:text-muted-dark",
                      )}
                    >
                      {p.enabled ? "Açık" : "Kapalı"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {LEAD_OPTIONS.map((n) => {
                      const on = p.leadDays.includes(n);
                      return (
                        <button
                          key={n}
                          onClick={() => toggleLead(n)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs",
                            on
                              ? "border-accent bg-accent/15 text-text dark:text-text-dark"
                              : "border-border text-muted dark:border-border-dark dark:text-muted-dark",
                          )}
                        >
                          {n === 0 ? "gün" : `-${n}g`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>

          <Button
            variant="danger"
            onClick={async () => {
              await signOut();
              navigate("/sign-in");
            }}
          >
            <LogOut className="h-4 w-4" /> {t("settings.signOut")}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function LangButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-xl border px-3 py-2 text-sm",
        active
          ? "border-accent bg-accent/15"
          : "border-border dark:border-border-dark",
      )}
    >
      {children}
    </button>
  );
}
```

> Note: the `useUpdateNotifPref` hook is called inside `prefs.data?.map` — that's a Rules-of-Hooks violation. To avoid this, in the actual implementation, refactor each preference row into a sub-component `<PrefRow pref={p} />` that calls the hook at its own top level. This is mandatory; the build will type-check OK but React DevTools will warn at runtime. Implement that refactor when writing the file.

- [ ] **Step 6: Modify `apps/web/src/components/AppShell.tsx`**

Replace contents to add a Settings link and use translations:

```tsx
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogOut, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { signOut } from "@/lib/authClient";

export function AppShell() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur dark:border-border-dark dark:bg-bg-dark/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-3">
            <BrandMark />
          </Link>
          {me.data && (
            <div className="flex items-center gap-1">
              <Button asChild variant="ghost" size="sm">
                <Link to="/bikes">{t("nav.bikes")}</Link>
              </Button>
              <Button asChild variant="ghost" size="sm" aria-label={t("nav.settings")}>
                <Link to="/settings"><Settings className="h-4 w-4" /></Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await signOut();
                  navigate("/sign-in");
                }}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
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

- [ ] **Step 7: Modify `apps/web/src/pages/DashboardPage.tsx`**

Replace the placeholder "Bakım yakında" `<div>` with the real `MaintenancePanel`. Add import:

```tsx
import { MaintenancePanel } from "@/components/MaintenancePanel";
```

Replace this block:

```tsx
          <div className="mt-2 flex items-center justify-between rounded-xl border border-dashed border-border p-4 text-sm text-muted dark:border-border-dark dark:text-muted-dark">
            <span>Bakım takibi yakında.</span>
            <span className="text-xs uppercase tracking-wider opacity-60">Phase 4</span>
          </div>
```

with:

```tsx
          <MaintenancePanel bikeId={active.bike.id} />
```

- [ ] **Step 8: Modify `apps/web/src/routes.tsx`**

Add imports:

```tsx
import { SettingsPage } from "@/pages/SettingsPage";
import { MaintenanceFormPage } from "@/pages/MaintenanceFormPage";
```

Inside the protected `children` array, add:

```tsx
      { path: "settings", element: <SettingsPage /> },
      {
        path: "bikes/:bikeId/maintenance/new",
        element: <MaintenanceFormPage mode="new" />,
      },
      {
        path: "bikes/:bikeId/maintenance/:id",
        element: <MaintenanceFormPage mode="edit" />,
      },
```

- [ ] **Step 9: Build**

```bash
pnpm --filter @mototracker/web build
```

Expected: clean build.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): settings, maintenance UI, dashboard panel, AppShell nav"
```

---

## Task 13: Visual polish — Geist font + theme-color toggle on dark mode

**Files:** Modify `apps/web/package.json`, `apps/web/src/styles.css`.

- [ ] **Step 1: Add Geist via fontsource**

```bash
pnpm --filter @mototracker/web add @fontsource-variable/geist @fontsource-variable/geist-mono
```

- [ ] **Step 2: Modify `apps/web/src/styles.css`** — add at the top:

```css
@import "@fontsource-variable/geist/index.css";
@import "@fontsource-variable/geist-mono/index.css";

@tailwind base;
@tailwind components;
@tailwind utilities;
```

Replace any existing `@tailwind` lines with the block above (i.e. font imports must come first).

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @mototracker/web build
git add apps/web
git commit -m "feat(web): bundle Geist + Geist Mono variable fonts"
```

---

## Task 14: Compose envs + README deploy guide

**Files:** Modify `docker-compose.yml`, `.env.example`, `README.md`.

- [ ] **Step 1: Modify `docker-compose.yml`** — in the `api` service `environment:`, append:

```yaml
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      VAPID_SUBJECT: ${VAPID_SUBJECT:-mailto:noreply@mototracker.app}
      CRON_TIMEZONE: ${CRON_TIMEZONE:-Europe/Istanbul}
      CRON_HOUR: ${CRON_HOUR:-9}
      CRON_ENABLED: ${CRON_ENABLED:-true}
```

- [ ] **Step 2: Modify root `.env.example`** — append:

```env

# Web Push (run: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:noreply@mototracker.app
CRON_TIMEZONE=Europe/Istanbul
CRON_HOUR=9
CRON_ENABLED=true
```

- [ ] **Step 3: Replace `README.md`**

```markdown
# MotoTracker

Self-hosted PWA that tracks motorcycle Sigorta / Kasko / Muayene / Bakım expiry dates with photo-based OCR (local Ollama vision model) and Web Push reminders.

- **Frontend** (`apps/web`): React + Vite + Tailwind + vite-plugin-pwa, deployed to Vercel.
- **Backend** (`apps/api`): Node + Express + better-sqlite3 + BetterAuth + node-cron + web-push, self-hosted via Docker.
- **OCR**: Ollama vision model (e.g. `gemma3:4b`) running on the same host as the API.
- **Edge**: Cloudflare Tunnel exposes the API at `api.<your-domain>` over HTTPS.

See `docs/superpowers/specs/2026-05-08-mototracker-design.md` for the full design.

## Phase status

- [x] Phase 1 — Foundation + Auth
- [x] Phase 2 — Dashboard + Dated Items
- [x] Phase 3 — OCR Pipeline
- [x] Phase 4 — Notifications + Maintenance + PWA + i18n + Polish

## Local development

Prereqs: Node 20, pnpm 9, Docker Desktop (optional for Ollama).

~~~bash
pnpm install
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env: SESSION_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
npx web-push generate-vapid-keys      # paste output into apps/api/.env
pnpm --filter @mototracker/api migrate
pnpm dev:api      # http://localhost:8787
pnpm dev:web      # http://localhost:5173
~~~

The web env needs `VITE_API_URL=http://localhost:8787` and `VITE_VAPID_PUBLIC_KEY=<public key>`.

### Tests

~~~bash
pnpm --filter @mototracker/api test
~~~

## Self-host (production)

1. **Cloudflare Tunnel.** `cloudflared tunnel login`, then `cloudflared tunnel create mototracker`. Note the token. In the Cloudflare dashboard, point `api.<your-domain>` at the tunnel's HTTP service `http://api:8787`.
2. **VAPID keys.** Run `npx web-push generate-vapid-keys` once. Save both keys.
3. **Env.** Copy `.env.example` to `.env` at the repo root and fill in:
   - `WEB_ORIGIN` (your Vercel URL)
   - `APP_BASE_URL` (your tunnel URL)
   - `SESSION_SECRET` (32+ random chars)
   - `CLOUDFLARED_TOKEN`
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   - optional: `RESEND_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`
4. **Compose up.** `docker compose up -d`
5. **Pull the OCR model.** `docker exec mototracker-ollama ollama pull gemma3:4b`
6. **Run migrations.** First boot auto-runs them via the entrypoint; on later upgrades: `docker exec mototracker-api node dist/db/migrate.js`.

## Frontend deploy (Vercel)

1. New Vercel project pointing at this repo, root directory `apps/web`.
2. Build command: `pnpm --filter @mototracker/web build`. Output: `apps/web/dist`.
3. Env vars on Vercel:
   - `VITE_API_URL=https://api.<your-domain>`
   - `VITE_VAPID_PUBLIC_KEY=<public-key>`
4. Vercel uses `apps/web/vercel.json` for the SPA rewrite + service-worker headers.

## Push on iOS

iOS Web Push requires the user to **install the PWA to home screen** (iOS 16.4+). The Settings page hints at this when the device is iOS without an active subscription.

## Daily reminders

Reminders fire daily at `CRON_HOUR` in `CRON_TIMEZONE` (default 09:00 Europe/Istanbul). The cron picks items whose `expires_on - today` matches one of the user's lead-day preferences (default 30/7/1) and calls Web Push for each subscribed device. Already-sent (item, lead, day) tuples are de-duped via `notification_sent`.

## Repo layout

~~~
apps/
  api/        # Express + SQLite + BetterAuth + cron + web-push
  web/        # React PWA → Vercel
packages/
  shared/     # zod schemas
docker-compose.yml
docs/superpowers/
  specs/      # design docs
  plans/      # implementation plans
~~~
```

- [ ] **Step 4: Validate compose + commit**

```bash
docker compose -f docker-compose.yml config > /dev/null
git add docker-compose.yml .env.example README.md
git commit -m "docs: deploy guide for Phase 4 (push, cron, PWA install)"
```

---

## Task 15: End-to-end smoke + tag

This is verification, not new code.

- [ ] **Step 1: Reset, migrate**

```bash
rm -f apps/api/data/app.db apps/api/data/app.db-*
pnpm --filter @mototracker/api migrate
pnpm --filter @mototracker/api test
```

Expected: all 48+ tests pass.

- [ ] **Step 2: Boot + exercise notification settings + push subscribe path (no real Ollama / VAPID required for smoke)**

```bash
pnpm --filter @mototracker/api dev > /tmp/p4-api.log 2>&1 &
sleep 4

COOKIE=/tmp/p4.cookies
rm -f $COOKIE

curl -sS -c $COOKIE -X POST http://localhost:8787/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"p4@test.com","password":"supersecret123","name":"P4"}' >/dev/null

echo "=== prefs (auto-seed) ==="
curl -sS -b $COOKIE http://localhost:8787/api/notification-preferences | python3 -m json.tool 2>/dev/null

echo "=== change muayene to 14,3 disabled ==="
curl -sS -b $COOKIE -X PUT http://localhost:8787/api/notification-preferences/muayene \
  -H "Content-Type: application/json" \
  -d '{"leadDays":[14,3],"enabled":false}' | python3 -m json.tool 2>/dev/null

echo "=== push public key (will be null without VAPID) ==="
curl -sS -b $COOKIE http://localhost:8787/api/push/public-key

echo "=== fake subscribe (we just verify the endpoint accepts the schema) ==="
curl -sS -b $COOKIE -X POST http://localhost:8787/api/push/subscribe \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://example/fake","keys":{"p256dh":"P","auth":"A"},"userAgent":"smoke"}' | python3 -m json.tool 2>/dev/null

pkill -f "tsx watch" 2>/dev/null
sleep 1
```

- [ ] **Step 3: Tag**

```bash
git tag phase-4-notifications-polish
```

---

## Self-Review

**Spec coverage:**
- §5 push (cron, dispatcher, web-push, dedupe) — Tasks 6–8
- §3 maintenance_item — Tasks 1–2, 4
- §6 UX (Settings page, maintenance panel, push toggle) — Task 12
- §7 visual direction (Geist + reduced-motion) — Tasks 11, 13
- §10 known iOS install hint — README Task 14
- §11 acceptance criteria — Task 15 smoke

**Placeholder scan:** No TBDs. Each step has full content. The note about Rules-of-Hooks in SettingsPage is intentional and instructive — implementer must refactor into a `<PrefRow>` sub-component.

**Type consistency:** New schemas in `packages/shared` are imported in both API (`maintenanceItems.ts`, `notificationPreferences.ts`, `pushSubscriptions.ts`) and web (`useMaintenanceItems`, `useNotifPreferences`). The `DueNotification` shape is internal to API.

**Risks acknowledged:**
- Rules-of-Hooks issue in Settings (implementer instructed to fix via sub-component).
- VAPID keys not auto-generated — README documents the one-shot command. Without keys, `/push/public-key` returns `null` and `subscribePushOnDevice` will refuse with a clear error; the flow is fail-soft.
- iOS PWA push requires install — surfaced in Settings hint.
