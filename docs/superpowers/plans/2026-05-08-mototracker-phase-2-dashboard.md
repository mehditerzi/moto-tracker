# MotoTracker — Phase 2: Dashboard + Dated Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard the centrepiece. Per bike, display the three dated items (Muayene, Sigorta, Kasko) as instrument-cluster style chips with days-remaining and color status. Allow manual create/edit, preserve renewal history.

**Architecture:** Add `dated_item` migration. Add `/api/bikes/:id/dated-items`, `PATCH /api/dated-items/:id`, `DELETE /api/dated-items/:id` and a `GET /api/dashboard` that returns each non-archived bike with its latest row per (bike, type) embedded. Replace `BikesPage` with `DashboardPage` as the new home; relocate bikes management to a "Manage" subpage.

**Tech stack:** Same as Phase 1. Adds `date-fns` and `date-fns-tz` to web; no new API deps.

**Spec:** `docs/superpowers/specs/2026-05-08-mototracker-design.md`

---

## File Structure (created/modified by this plan)

Created:

```
apps/api/src/db/migrations/002_dated_item.sql
apps/api/src/routes/datedItems.ts
apps/api/src/routes/dashboard.ts
apps/api/tests/datedItems.test.ts
apps/api/tests/dashboard.test.ts

packages/shared/src/schemas/datedItem.ts

apps/web/src/hooks/useDatedItems.ts
apps/web/src/hooks/useDashboard.ts
apps/web/src/lib/datedItems.ts          # days-remaining + status color helpers
apps/web/src/components/StatusChip.tsx
apps/web/src/components/BikeSwitcher.tsx
apps/web/src/pages/DashboardPage.tsx
apps/web/src/pages/DatedItemFormPage.tsx
apps/web/src/pages/DatedItemDetailPage.tsx
```

Modified:

```
apps/api/src/server.ts                   # mount datedItems + dashboard routers
packages/shared/src/index.ts             # re-export datedItem
apps/web/src/routes.tsx                  # /dashboard becomes default; /bikes still works
apps/web/src/components/AppShell.tsx     # add a manage-bikes link in the header
```

---

## Task 1: DB migration for `dated_item`

**Files:**
- Create: `apps/api/src/db/migrations/002_dated_item.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS dated_item (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sigorta','kasko','muayene')),
  expires_on TEXT NOT NULL,                  -- ISO YYYY-MM-DD
  provider TEXT,
  policy_no TEXT,
  cost REAL,
  notes TEXT,
  source_document_id TEXT,                   -- nullable; document table arrives in Phase 3
  ocr_confidence REAL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dated_user_type_exp ON dated_item(user_id, type, expires_on);
CREATE INDEX IF NOT EXISTS idx_dated_bike_type ON dated_item(bike_id, type, expires_on DESC);
```

- [ ] **Step 2: Apply migration to dev DB and confirm**

```bash
pnpm --filter @mototracker/api run migrate
sqlite3 apps/api/data/app.db ".schema dated_item"
```

Expected: `[migrate] applied: 1, skipped: 1` and a `.schema` printout that matches the SQL above.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/db/migrations/002_dated_item.sql
git commit -m "feat(api): migration for dated_item table"
```

---

## Task 2: Shared zod schemas for dated items

**Files:**
- Create: `packages/shared/src/schemas/datedItem.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write packages/shared/src/schemas/datedItem.ts**

```ts
import { z } from "zod";

export const datedItemTypeSchema = z.enum(["sigorta", "kasko", "muayene"]);
export type DatedItemType = z.infer<typeof datedItemTypeSchema>;

export const datedItemSchema = z.object({
  id: z.string(),
  bikeId: z.string(),
  userId: z.string(),
  type: datedItemTypeSchema,
  expiresOn: z.string(),                       // YYYY-MM-DD
  provider: z.string().nullable(),
  policyNo: z.string().nullable(),
  cost: z.number().nullable(),
  notes: z.string().nullable(),
  sourceDocumentId: z.string().nullable(),
  ocrConfidence: z.number().nullable(),
  needsReview: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DatedItem = z.infer<typeof datedItemSchema>;

export const datedItemCreateSchema = z.object({
  type: datedItemTypeSchema,
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor"),
  provider: z.string().max(120).nullable().optional(),
  policyNo: z.string().max(80).nullable().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type DatedItemCreateInput = z.infer<typeof datedItemCreateSchema>;

export const datedItemUpdateSchema = datedItemCreateSchema.partial();
export type DatedItemUpdateInput = z.infer<typeof datedItemUpdateSchema>;

export const dashboardEntrySchema = z.object({
  bike: z.object({
    id: z.string(),
    nickname: z.string(),
    plate: z.string().nullable(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    year: z.number().nullable(),
    color: z.string().nullable(),
    photoUrl: z.string().nullable(),
  }),
  items: z.object({
    sigorta: datedItemSchema.nullable(),
    kasko: datedItemSchema.nullable(),
    muayene: datedItemSchema.nullable(),
  }),
});
export type DashboardEntry = z.infer<typeof dashboardEntrySchema>;
```

- [ ] **Step 2: Append re-export to packages/shared/src/index.ts**

Append the line (do not remove existing exports):

```ts
export * from "./schemas/datedItem";
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @mototracker/shared run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): zod schemas for dated_item and dashboard"
```

---

## Task 3: API — dated items CRUD routes

**Files:**
- Create: `apps/api/src/routes/datedItems.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write apps/api/src/routes/datedItems.ts**

```ts
import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { datedItemCreateSchema, datedItemUpdateSchema } from "@mototracker/shared";

interface DatedItemRow {
  id: string;
  bike_id: string;
  user_id: string;
  type: "sigorta" | "kasko" | "muayene";
  expires_on: string;
  provider: string | null;
  policy_no: string | null;
  cost: number | null;
  notes: string | null;
  source_document_id: string | null;
  ocr_confidence: number | null;
  needs_review: number;
  created_at: string;
  updated_at: string;
}

export function rowToDatedItem(r: DatedItemRow) {
  return {
    id: r.id,
    bikeId: r.bike_id,
    userId: r.user_id,
    type: r.type,
    expiresOn: r.expires_on,
    provider: r.provider,
    policyNo: r.policy_no,
    cost: r.cost,
    notes: r.notes,
    sourceDocumentId: r.source_document_id,
    ocrConfidence: r.ocr_confidence,
    needsReview: r.needs_review === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Mounted at /api/bikes — exposes child route :id/dated-items
export const bikesNestedDatedRouter: Router = Router({ mergeParams: true });
bikesNestedDatedRouter.use(requireUser);

bikesNestedDatedRouter.get(
  "/:id/dated-items",
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
        "SELECT * FROM dated_item WHERE bike_id = ? AND user_id = ? ORDER BY type ASC, expires_on DESC",
      )
      .all(req.params.id, req.user!.id) as DatedItemRow[];
    res.json(rows.map(rowToDatedItem));
  }),
);

bikesNestedDatedRouter.post(
  "/:id/dated-items",
  asyncHandler(async (req, res) => {
    const body = datedItemCreateSchema.parse(req.body);
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
      `INSERT INTO dated_item (id, bike_id, user_id, type, expires_on, provider, policy_no, cost, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.params.id,
      req.user!.id,
      body.type,
      body.expiresOn,
      body.provider ?? null,
      body.policyNo ?? null,
      body.cost ?? null,
      body.notes ?? null,
    );
    const row = db.prepare("SELECT * FROM dated_item WHERE id = ?").get(id) as DatedItemRow;
    res.status(201).json(rowToDatedItem(row));
  }),
);

// Mounted at /api/dated-items
export const datedItemsRouter: Router = Router();
datedItemsRouter.use(requireUser);

datedItemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM dated_item WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as DatedItemRow | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToDatedItem(row));
  }),
);

datedItemsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = datedItemUpdateSchema.parse(req.body);
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM dated_item WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const fieldMap: Record<string, string> = {
      type: "type",
      expiresOn: "expires_on",
      provider: "provider",
      policyNo: "policy_no",
      cost: "cost",
      notes: "notes",
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
      db.prepare(`UPDATE dated_item SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(
        ...values,
      );
    }
    const row = db.prepare("SELECT * FROM dated_item WHERE id = ?").get(req.params.id) as DatedItemRow;
    res.json(rowToDatedItem(row));
  }),
);

datedItemsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db
      .prepare("DELETE FROM dated_item WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  }),
);
```

- [ ] **Step 2: Modify apps/api/src/server.ts**

Add imports near the other route imports:

```ts
import { bikesNestedDatedRouter, datedItemsRouter } from "./routes/datedItems.js";
```

After the existing `app.use("/api/bikes", bikesRouter);` line, add:

```ts
  app.use("/api/bikes", bikesNestedDatedRouter);
  app.use("/api/dated-items", datedItemsRouter);
```

- [ ] **Step 3: Commit**

```bash
git add apps/api
git commit -m "feat(api): dated_item CRUD routes"
```

---

## Task 4: API — dashboard endpoint

**Files:**
- Create: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write apps/api/src/routes/dashboard.ts**

```ts
import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { rowToDatedItem } from "./datedItems.js";

interface BikeRow {
  id: string;
  nickname: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  photo_url: string | null;
}

export const dashboardRouter: Router = Router();
dashboardRouter.use(requireUser);

const ITEM_TYPES = ["sigorta", "kasko", "muayene"] as const;

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bikes = db
      .prepare(
        `SELECT id, nickname, plate, make, model, year, color, photo_url
         FROM bike
         WHERE user_id = ? AND archived = 0
         ORDER BY created_at ASC`,
      )
      .all(req.user!.id) as BikeRow[];

    // For each bike, fetch the latest row per type in a single query.
    const latestStmt = db.prepare(
      `SELECT * FROM dated_item
       WHERE bike_id = ? AND user_id = ? AND type = ?
       ORDER BY expires_on DESC, created_at DESC
       LIMIT 1`,
    );

    const result = bikes.map((b) => {
      const items: Record<string, ReturnType<typeof rowToDatedItem> | null> = {
        sigorta: null,
        kasko: null,
        muayene: null,
      };
      for (const t of ITEM_TYPES) {
        const row = latestStmt.get(b.id, req.user!.id, t) as
          | Parameters<typeof rowToDatedItem>[0]
          | undefined;
        items[t] = row ? rowToDatedItem(row) : null;
      }
      return {
        bike: {
          id: b.id,
          nickname: b.nickname,
          plate: b.plate,
          make: b.make,
          model: b.model,
          year: b.year,
          color: b.color,
          photoUrl: b.photo_url,
        },
        items,
      };
    });
    res.json(result);
  }),
);
```

- [ ] **Step 2: Modify apps/api/src/server.ts**

Add import:

```ts
import { dashboardRouter } from "./routes/dashboard.js";
```

After `app.use("/api/dated-items", datedItemsRouter);` add:

```ts
  app.use("/api/dashboard", dashboardRouter);
```

- [ ] **Step 3: Commit**

```bash
git add apps/api
git commit -m "feat(api): dashboard endpoint with latest dated items per bike"
```

---

## Task 5: API tests for dated items + dashboard

**Files:**
- Create: `apps/api/tests/datedItems.test.ts`
- Create: `apps/api/tests/dashboard.test.ts`

- [ ] **Step 1: Write apps/api/tests/datedItems.test.ts**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

async function createBike(app: ReturnType<typeof buildTestApp>, cookie: string, nickname = "B1") {
  const res = await request(app)
    .post("/api/bikes")
    .set("Cookie", cookie)
    .set("Content-Type", "application/json")
    .send({ nickname });
  return res.body.id as string;
}

describe("/api/bikes/:id/dated-items + /api/dated-items/:id", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/bikes/x/dated-items");
    expect(res.status).toBe(401);
  });

  it("create + list + get + patch + delete", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie);

    const create = await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ type: "sigorta", expiresOn: "2027-03-01", provider: "Acme" });
    expect(create.status).toBe(201);
    const id = create.body.id;
    expect(create.body.type).toBe("sigorta");
    expect(create.body.expiresOn).toBe("2027-03-01");

    const list = await request(app)
      .get(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const get1 = await request(app).get(`/api/dated-items/${id}`).set("Cookie", cookie);
    expect(get1.status).toBe(200);
    expect(get1.body.provider).toBe("Acme");

    const patch = await request(app)
      .patch(`/api/dated-items/${id}`)
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ provider: "AcmeV2", expiresOn: "2027-04-15" });
    expect(patch.status).toBe(200);
    expect(patch.body.provider).toBe("AcmeV2");
    expect(patch.body.expiresOn).toBe("2027-04-15");

    const del = await request(app).delete(`/api/dated-items/${id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/dated-items/${id}`).set("Cookie", cookie);
    expect(after.status).toBe(404);
  });

  it("rejects expiresOn that is not YYYY-MM-DD", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie);
    const res = await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ type: "sigorta", expiresOn: "01/03/2027" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when accessing another user's item", async () => {
    const app = buildTestApp();
    const u1 = await signUpAndSignIn(app, "alice@test.com");
    const u2 = await signUpAndSignIn(app, "bob@test.com");
    const bikeId = await createBike(app, u1.cookie);
    const create = await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", u1.cookie)
      .set("Content-Type", "application/json")
      .send({ type: "muayene", expiresOn: "2026-12-31" });
    const id = create.body.id;
    const cross = await request(app).get(`/api/dated-items/${id}`).set("Cookie", u2.cookie);
    expect(cross.status).toBe(404);
  });

  it("preserves history: two sigorta rows for the same bike are both kept", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie);
    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .send({ type: "sigorta", expiresOn: "2025-03-01" });
    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .send({ type: "sigorta", expiresOn: "2026-03-01" });
    const list = await request(app)
      .get(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie);
    expect(list.body.filter((r: { type: string }) => r.type === "sigorta")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Write apps/api/tests/dashboard.test.ts**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/dashboard", () => {
  it("returns empty list for new user", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/dashboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns one entry per non-archived bike with latest dated items embedded", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);

    const bikeRes = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "Monster" });
    const bikeId = bikeRes.body.id;

    // Two sigorta rows; the later one should win.
    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .send({ type: "sigorta", expiresOn: "2025-03-01" });
    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .send({ type: "sigorta", expiresOn: "2027-03-01" });
    // One muayene row.
    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .send({ type: "muayene", expiresOn: "2026-08-15" });

    const res = await request(app).get("/api/dashboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const entry = res.body[0];
    expect(entry.bike.nickname).toBe("Monster");
    expect(entry.items.sigorta?.expiresOn).toBe("2027-03-01");
    expect(entry.items.muayene?.expiresOn).toBe("2026-08-15");
    expect(entry.items.kasko).toBeNull();
  });

  it("excludes archived bikes", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const r1 = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "Active" });
    const r2 = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "Old" });
    await request(app).delete(`/api/bikes/${r2.body.id}`).set("Cookie", cookie);
    const res = await request(app).get("/api/dashboard").set("Cookie", cookie);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].bike.id).toBe(r1.body.id);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @mototracker/api test
```

Expected: prior 11 tests + 7 new tests = 18 passing.

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests
git commit -m "test(api): dated items and dashboard"
```

---

## Task 6: Web — date helpers + status math

**Files:**
- Create: `apps/web/src/lib/datedItems.ts`

- [ ] **Step 1: Add date-fns + date-fns-tz to apps/web**

```bash
pnpm --filter @mototracker/web add date-fns date-fns-tz
```

- [ ] **Step 2: Write apps/web/src/lib/datedItems.ts**

```ts
import { differenceInCalendarDays, parseISO } from "date-fns";
import type { DatedItemType } from "@mototracker/shared";

export type Status = "ok" | "soon" | "danger" | "expired" | "unset";

export interface StatusInfo {
  status: Status;
  daysRemaining: number | null;
}

export function statusFor(expiresOn: string | null | undefined, today = new Date()): StatusInfo {
  if (!expiresOn) return { status: "unset", daysRemaining: null };
  const target = parseISO(expiresOn);
  const days = differenceInCalendarDays(target, today);
  if (days < 0) return { status: "expired", daysRemaining: days };
  if (days <= 7) return { status: "danger", daysRemaining: days };
  if (days <= 30) return { status: "soon", daysRemaining: days };
  return { status: "ok", daysRemaining: days };
}

export const TYPE_LABEL_TR: Record<DatedItemType, string> = {
  sigorta: "Sigorta",
  kasko: "Kasko",
  muayene: "Muayene",
};

export const TYPE_LABEL_EN: Record<DatedItemType, string> = {
  sigorta: "Insurance",
  kasko: "Kasko",
  muayene: "Inspection",
};

export const TYPE_ORDER: DatedItemType[] = ["muayene", "sigorta", "kasko"];

export function statusColorClass(status: Status): string {
  switch (status) {
    case "ok":
      return "text-success border-success/40 bg-success/10";
    case "soon":
      return "text-warning border-warning/40 bg-warning/10";
    case "danger":
    case "expired":
      return "text-danger border-danger/40 bg-danger/10";
    case "unset":
      return "text-muted border-border bg-surface dark:border-border-dark dark:bg-surface-elev-dark";
  }
}

export function statusRingClass(status: Status): string {
  switch (status) {
    case "ok":
      return "ring-2 ring-success/30";
    case "soon":
      return "ring-2 ring-warning/30";
    case "danger":
    case "expired":
      return "ring-2 ring-danger/40";
    case "unset":
      return "ring-1 ring-border dark:ring-border-dark";
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): date helpers and status color math for dated items"
```

---

## Task 7: Web — TanStack Query hooks for dated items + dashboard

**Files:**
- Create: `apps/web/src/hooks/useDatedItems.ts`
- Create: `apps/web/src/hooks/useDashboard.ts`

- [ ] **Step 1: Write apps/web/src/hooks/useDatedItems.ts**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  DatedItem,
  DatedItemCreateInput,
  DatedItemUpdateInput,
} from "@mototracker/shared";

export function useDatedItemsForBike(bikeId: string | undefined) {
  return useQuery<DatedItem[]>({
    queryKey: ["dated-items", "bike", bikeId],
    queryFn: () => api<DatedItem[]>(`/api/bikes/${bikeId}/dated-items`),
    enabled: !!bikeId,
  });
}

export function useDatedItem(id: string | undefined) {
  return useQuery<DatedItem>({
    queryKey: ["dated-items", id],
    queryFn: () => api<DatedItem>(`/api/dated-items/${id}`),
    enabled: !!id,
  });
}

export function useCreateDatedItem(bikeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DatedItemCreateInput) =>
      api<DatedItem>(`/api/bikes/${bikeId}/dated-items`, { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dated-items", "bike", bikeId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateDatedItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DatedItemUpdateInput) =>
      api<DatedItem>(`/api/dated-items/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dated-items"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteDatedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/dated-items/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dated-items"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
```

- [ ] **Step 2: Write apps/web/src/hooks/useDashboard.ts**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DashboardEntry } from "@mototracker/shared";

export function useDashboard() {
  return useQuery<DashboardEntry[]>({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardEntry[]>("/api/dashboard"),
  });
}
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @mototracker/web exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): hooks for dated items and dashboard"
```

---

## Task 8: Web — `StatusChip` component

**Files:**
- Create: `apps/web/src/components/StatusChip.tsx`

- [ ] **Step 1: Write apps/web/src/components/StatusChip.tsx**

```tsx
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { DatedItem, DatedItemType } from "@mototracker/shared";
import {
  statusFor,
  statusColorClass,
  statusRingClass,
  TYPE_LABEL_TR,
} from "@/lib/datedItems";
import { cn } from "@/lib/cn";

interface Props {
  type: DatedItemType;
  bikeId: string;
  item: DatedItem | null;
}

export function StatusChip({ type, bikeId, item }: Props) {
  const info = statusFor(item?.expiresOn);
  const label = TYPE_LABEL_TR[type];
  const color = statusColorClass(info.status);
  const ring = statusRingClass(info.status);

  const headline = (() => {
    if (info.status === "unset") return "—";
    if (info.daysRemaining === null) return "—";
    if (info.daysRemaining < 0) return "Geçti";
    return info.daysRemaining;
  })();

  const sub = (() => {
    if (info.status === "unset") return "Tarih ekle";
    if (info.daysRemaining === null) return "";
    if (info.daysRemaining < 0) return `${Math.abs(info.daysRemaining)} gün önce`;
    return "gün kaldı";
  })();

  const linkTo = item
    ? `/dated-items/${item.id}`
    : `/bikes/${bikeId}/dated-items/new?type=${type}`;

  return (
    <Link to={linkTo} className="block">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "relative flex flex-col gap-1 rounded-xl border p-4 transition",
          color,
          ring,
          info.status === "danger" || info.status === "expired"
            ? "after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:ring-2 after:ring-danger/0 after:animate-[pulse_1.6s_ease-in-out_infinite]"
            : "",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider opacity-80">
            {label}
          </span>
          {info.status === "unset" && <Plus className="h-3.5 w-3.5 opacity-60" />}
        </div>
        <div className="font-mono text-4xl font-semibold tabular-nums leading-none">
          {headline}
        </div>
        <div className="text-xs opacity-80">
          {sub}
          {item?.expiresOn && info.status !== "unset" && (
            <span className="ml-2 opacity-70">· {item.expiresOn}</span>
          )}
        </div>
      </motion.div>
    </Link>
  );
}
```

- [ ] **Step 2: Commit (defer to Task 11 along with dashboard page)**

Skip commit — leave file uncommitted for now.

---

## Task 9: Web — `BikeSwitcher` component

**Files:**
- Create: `apps/web/src/components/BikeSwitcher.tsx`

- [ ] **Step 1: Write apps/web/src/components/BikeSwitcher.tsx**

```tsx
import { motion } from "framer-motion";
import type { DashboardEntry } from "@mototracker/shared";
import { cn } from "@/lib/cn";

interface Props {
  entries: DashboardEntry[];
  activeBikeId: string | undefined;
  onSelect: (bikeId: string) => void;
}

export function BikeSwitcher({ entries, activeBikeId, onSelect }: Props) {
  if (entries.length <= 1) return null;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {entries.map((e) => {
        const active = e.bike.id === activeBikeId;
        return (
          <button
            key={e.bike.id}
            onClick={() => onSelect(e.bike.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition",
              active
                ? "border-accent text-text dark:text-text-dark"
                : "border-border text-muted hover:text-text dark:border-border-dark dark:hover:text-text-dark",
            )}
          >
            {active && (
              <motion.span
                layoutId="bike-pill-bg"
                className="absolute inset-0 -z-10 rounded-full bg-accent/15"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="font-medium">{e.bike.nickname}</span>
            {e.bike.plate && <span className="font-mono text-xs opacity-70">{e.bike.plate}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Skip commit (will be in Task 11).**

---

## Task 10: Web — `DashboardPage`

**Files:**
- Create: `apps/web/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Write apps/web/src/pages/DashboardPage.tsx**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Settings2, Bike as BikeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/hooks/useDashboard";
import { StatusChip } from "@/components/StatusChip";
import { BikeSwitcher } from "@/components/BikeSwitcher";
import { TYPE_ORDER } from "@/lib/datedItems";

export function DashboardPage() {
  const dash = useDashboard();
  const [activeBikeId, setActiveBikeId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (dash.data && dash.data.length > 0 && !activeBikeId) {
      setActiveBikeId(dash.data[0].bike.id);
    }
  }, [dash.data, activeBikeId]);

  if (dash.isLoading) {
    return <p className="text-center text-muted dark:text-muted-dark">Yükleniyor...</p>;
  }
  if (dash.isError || !dash.data) {
    return <p className="text-center text-danger">Yüklenemedi.</p>;
  }

  if (dash.data.length === 0) {
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
          <Link to="/bikes/new">
            <Plus className="h-4 w-4" /> Bir motosiklet ekle
          </Link>
        </Button>
      </motion.div>
    );
  }

  const active = dash.data.find((e) => e.bike.id === activeBikeId) ?? dash.data[0];

  return (
    <div className="flex flex-col gap-5">
      <BikeSwitcher
        entries={dash.data}
        activeBikeId={active.bike.id}
        onSelect={setActiveBikeId}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={active.bike.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col gap-4"
        >
          <header className="flex items-end justify-between">
            <div>
              <div className="text-sm uppercase tracking-wider text-muted dark:text-muted-dark">
                Aktif motosiklet
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{active.bike.nickname}</h1>
              <p className="text-sm text-muted dark:text-muted-dark">
                {[active.bike.make, active.bike.model, active.bike.year]
                  .filter(Boolean)
                  .join(" · ") || "—"}
                {active.bike.plate && (
                  <span className="ml-2 font-mono">· {active.bike.plate}</span>
                )}
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/bikes/${active.bike.id}/edit`}>
                <Settings2 className="h-4 w-4" />
              </Link>
            </Button>
          </header>

          <div className="grid gap-3 sm:grid-cols-3">
            {TYPE_ORDER.map((t) => (
              <StatusChip key={t} type={t} bikeId={active.bike.id} item={active.items[t]} />
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between rounded-xl border border-dashed border-border p-4 text-sm text-muted dark:border-border-dark dark:text-muted-dark">
            <span>Bakım takibi yakında.</span>
            <span className="text-xs uppercase tracking-wider opacity-60">Phase 4</span>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex items-center justify-end">
        <Button asChild size="sm" variant="outline">
          <Link to="/bikes">
            <Plus className="h-4 w-4" /> Motosikletleri yönet
          </Link>
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Skip commit (Task 11 will commit chip + switcher + dashboard together).**

---

## Task 11: Web — `DatedItemFormPage` and `DatedItemDetailPage`

**Files:**
- Create: `apps/web/src/pages/DatedItemFormPage.tsx`
- Create: `apps/web/src/pages/DatedItemDetailPage.tsx`

- [ ] **Step 1: Write apps/web/src/pages/DatedItemFormPage.tsx**

```tsx
import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pushToast } from "@/hooks/useToast";
import {
  useCreateDatedItem,
  useDatedItem,
  useDeleteDatedItem,
  useUpdateDatedItem,
} from "@/hooks/useDatedItems";
import type { DatedItemType } from "@mototracker/shared";
import { TYPE_LABEL_TR } from "@/lib/datedItems";

const datedItemTypeValues = ["sigorta", "kasko", "muayene"] as const;

const schema = z.object({
  type: z.enum(datedItemTypeValues),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG formatında girin"),
  provider: z.string().max(120).optional().or(z.literal("")),
  policyNo: z.string().max(80).optional().or(z.literal("")),
  cost: z
    .union([z.coerce.number().nonnegative(), z.literal("")])
    .optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  mode: "new" | "edit";
}

export function DatedItemFormPage({ mode }: Props) {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const isEdit = mode === "edit";
  const itemId = isEdit ? params.id : undefined;
  const bikeId = !isEdit ? params.bikeId : undefined;

  const item = useDatedItem(itemId);
  const createMut = useCreateDatedItem(bikeId ?? "");
  const updateMut = useUpdateDatedItem(itemId ?? "");
  const deleteMut = useDeleteDatedItem();

  const initialType = (search.get("type") as DatedItemType | null) ?? "sigorta";

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: initialType, expiresOn: "" },
  });

  useEffect(() => {
    if (isEdit && item.data) {
      form.reset({
        type: item.data.type,
        expiresOn: item.data.expiresOn,
        provider: item.data.provider ?? "",
        policyNo: item.data.policyNo ?? "",
        cost: item.data.cost ?? "",
        notes: item.data.notes ?? "",
      });
    }
  }, [isEdit, item.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const payload = {
      type: v.type,
      expiresOn: v.expiresOn,
      provider: v.provider || null,
      policyNo: v.policyNo || null,
      cost: typeof v.cost === "number" ? v.cost : null,
      notes: v.notes || null,
    };
    try {
      if (isEdit && itemId) {
        await updateMut.mutateAsync(payload);
        pushToast({ variant: "success", title: "Güncellendi" });
        navigate(`/dated-items/${itemId}`);
      } else {
        const created = await createMut.mutateAsync(payload);
        pushToast({ variant: "success", title: "Eklendi" });
        navigate(`/dated-items/${created.id}`);
      }
    } catch (e) {
      pushToast({ variant: "danger", title: "Kaydedilemedi", description: String(e) });
    }
  });

  const onDelete = async () => {
    if (!itemId) return;
    if (!confirm("Bu kaydı silmek istiyor musun?")) return;
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
          <CardTitle>
            {isEdit ? "Kaydı düzenle" : `Yeni ${TYPE_LABEL_TR[initialType]} kaydı`}
          </CardTitle>
          <CardDescription>Bitiş tarihini ve isteğe bağlı detayları gir.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="type">Tür</Label>
              <select
                id="type"
                {...form.register("type")}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              >
                {datedItemTypeValues.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL_TR[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="expiresOn">Bitiş tarihi</Label>
              <Input id="expiresOn" type="date" {...form.register("expiresOn")} />
              {form.formState.errors.expiresOn && (
                <p className="text-xs text-danger">{form.formState.errors.expiresOn.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="provider">Şirket</Label>
              <Input id="provider" {...form.register("provider")} placeholder="Acme Sigorta" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="policyNo">Poliçe no</Label>
              <Input id="policyNo" {...form.register("policyNo")} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cost">Tutar (TL)</Label>
              <Input id="cost" type="number" step="0.01" {...form.register("cost")} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="notes">Not</Label>
              <textarea
                id="notes"
                {...form.register("notes")}
                rows={3}
                className="rounded-xl border border-border bg-surface p-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="accent" className="flex-1">
                {isEdit ? "Kaydet" : "Ekle"}
              </Button>
              <Button asChild variant="ghost" className="flex-1">
                <Link to={isEdit && itemId ? `/dated-items/${itemId}` : "/dashboard"}>
                  İptal
                </Link>
              </Button>
            </div>
            {isEdit && (
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

- [ ] **Step 2: Write apps/web/src/pages/DatedItemDetailPage.tsx**

```tsx
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Pencil, RotateCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDatedItem, useDatedItemsForBike } from "@/hooks/useDatedItems";
import { statusFor, statusColorClass, TYPE_LABEL_TR } from "@/lib/datedItems";
import { cn } from "@/lib/cn";

export function DatedItemDetailPage() {
  const { id } = useParams();
  const item = useDatedItem(id);
  const history = useDatedItemsForBike(item.data?.bikeId);

  if (item.isLoading) {
    return <p className="text-center text-muted dark:text-muted-dark">Yükleniyor...</p>;
  }
  if (item.isError || !item.data) {
    return <p className="text-center text-danger">Bulunamadı.</p>;
  }

  const info = statusFor(item.data.expiresOn);
  const sameType = (history.data ?? [])
    .filter((r) => r.type === item.data!.type)
    .sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-4"
    >
      <Card>
        <CardHeader>
          <CardTitle>{TYPE_LABEL_TR[item.data.type]}</CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <div
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border p-4",
              statusColorClass(info.status),
            )}
          >
            <div className="font-mono text-5xl font-semibold tabular-nums leading-none">
              {info.daysRemaining === null
                ? "—"
                : info.daysRemaining < 0
                  ? "Geçti"
                  : info.daysRemaining}
            </div>
            <div className="text-xs opacity-80">
              {info.daysRemaining !== null && info.daysRemaining >= 0 ? "gün kaldı" : ""}
            </div>
            <div className="mt-1 text-sm opacity-80">{item.data.expiresOn}</div>
          </div>

          <Field label="Şirket" value={item.data.provider} />
          <Field label="Poliçe no" value={item.data.policyNo} />
          <Field label="Tutar" value={item.data.cost !== null ? `${item.data.cost} TL` : null} />
          <Field label="Not" value={item.data.notes} multiline />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild variant="accent" className="flex-1">
          <Link to={`/bikes/${item.data.bikeId}/dated-items/new?type=${item.data.type}`}>
            <RotateCw className="h-4 w-4" /> Yenile
          </Link>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <Link to={`/dated-items/${item.data.id}/edit`}>
            <Pencil className="h-4 w-4" /> Düzenle
          </Link>
        </Button>
      </div>

      {sameType.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Geçmiş</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {sameType.map((r) => {
                const s = statusFor(r.expiresOn);
                return (
                  <li key={r.id}>
                    <Link
                      to={`/dated-items/${r.id}`}
                      className={cn(
                        "flex items-center justify-between rounded-xl border p-3 text-sm",
                        statusColorClass(s.status),
                        r.id === item.data!.id && "ring-2 ring-accent/40",
                      )}
                    >
                      <span className="font-mono">{r.expiresOn}</span>
                      <span className="opacity-80">{r.provider ?? "—"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
        {label}
      </span>
      <span className={multiline ? "whitespace-pre-wrap text-sm" : "text-sm"}>
        {value ?? <em className="opacity-60">—</em>}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Build to verify**

```bash
pnpm --filter @mototracker/web build
```

Expected: clean build (the new pages aren't routed yet — that comes next, but they should typecheck).

- [ ] **Step 4: Commit chips, switcher, dashboard, form, detail together**

```bash
git add apps/web/src/components/StatusChip.tsx apps/web/src/components/BikeSwitcher.tsx apps/web/src/pages/DashboardPage.tsx apps/web/src/pages/DatedItemFormPage.tsx apps/web/src/pages/DatedItemDetailPage.tsx
git commit -m "feat(web): dashboard, status chips, bike switcher, dated item form/detail"
```

---

## Task 12: Web — wire routes + AppShell update

**Files:**
- Modify: `apps/web/src/routes.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`

- [ ] **Step 1: Modify apps/web/src/routes.tsx**

Replace the imports and route children to add the new pages. The full new file contents:

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
import { DashboardPage } from "@/pages/DashboardPage";
import { DatedItemFormPage } from "@/pages/DatedItemFormPage";
import { DatedItemDetailPage } from "@/pages/DatedItemDetailPage";
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
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "bikes", element: <BikesPage /> },
      { path: "bikes/new", element: <BikeFormPage /> },
      { path: "bikes/:id/edit", element: <BikeFormPage /> },
      {
        path: "bikes/:bikeId/dated-items/new",
        element: <DatedItemFormPage mode="new" />,
      },
      { path: "dated-items/:id", element: <DatedItemDetailPage /> },
      { path: "dated-items/:id/edit", element: <DatedItemFormPage mode="edit" /> },
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

- [ ] **Step 2: Modify apps/web/src/components/AppShell.tsx**

Add a "Motosikletler" link beside the brand mark. The full file:

```tsx
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { signOut } from "@/lib/authClient";

export function AppShell() {
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
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link to="/bikes">Motosikletler</Link>
              </Button>
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

- [ ] **Step 3: Build to verify**

```bash
pnpm --filter @mototracker/web build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): wire dashboard + dated-items routes; add Motosikletler nav"
```

---

## Task 13: End-to-end smoke

- [ ] **Step 1: Reset DB and migrate**

```bash
rm -f apps/api/data/app.db apps/api/data/app.db-*
pnpm --filter @mototracker/api migrate
```

- [ ] **Step 2: Start API and exercise endpoints via curl**

```bash
pnpm --filter @mototracker/api dev > /tmp/p2-api.log 2>&1 &
sleep 4

COOKIE=/tmp/p2.cookies
rm -f $COOKIE

# sign up
curl -sS -c $COOKIE -X POST http://localhost:8787/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"p2@test.com","password":"supersecret123","name":"P2"}' >/dev/null

# create a bike
BIKE_ID=$(curl -sS -b $COOKIE -X POST http://localhost:8787/api/bikes \
  -H "Content-Type: application/json" \
  -d '{"nickname":"Monster"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "BIKE_ID=$BIKE_ID"

# create one of each type
for T in sigorta kasko muayene; do
  curl -sS -b $COOKIE -X POST "http://localhost:8787/api/bikes/$BIKE_ID/dated-items" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"$T\",\"expiresOn\":\"2027-06-01\"}" | head -c 100
  echo
done

# dashboard
echo "=== /api/dashboard ==="
curl -sS -b $COOKIE http://localhost:8787/api/dashboard | head -c 600
echo

# stop server
pkill -f "tsx watch src/index.ts" 2>/dev/null
sleep 1
```

Expected: dashboard JSON has a single entry whose `items.sigorta`, `items.kasko`, `items.muayene` all show `expiresOn: "2027-06-01"`.

- [ ] **Step 3: Tag**

```bash
git tag phase-2-dashboard
```

---

## Self-Review

**Spec coverage:** Phase 2 covers spec sections 6 (UX dashboard), 8 (the 3 dated-item endpoints + dashboard), and the dated_item portion of section 3. Maintenance, OCR, push, and visual polish remain for later phases.

**Placeholder scan:** No TBD/TODO. Each step has full content. Test code is concrete and runnable.

**Type consistency:** Schema is consistent across `packages/shared`, API routes, and web hooks. SQL columns (`expires_on`, `policy_no`, `current_km`) map to camelCase via centralized row-to-object converters (`rowToDatedItem`, `rowToBike`).

**Known follow-ups:**
- Maintenance card in dashboard is a placeholder pointing to Phase 4.
- No PWA manifest / service worker yet (Phase 4).
- Dashboard doesn't yet integrate document/OCR (Phase 3 will).
