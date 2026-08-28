import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { resetDbForTests, getDb, closeDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { seedCatalog } from "../src/db/seedCatalog.js";
import { buildApp } from "../src/server.js";
import { bikeScope, userOrgs } from "../src/lib/orgAccess.js";

/**
 * The demo fleets are a sales asset AND the account Apple's reviewer signs in
 * with (Guideline 2.1(a)), so "it looked right when I ran it" is not enough.
 *
 * This seeds into a real file database and then interrogates it through the
 * actual fleet endpoints: does the triage board tell the story (§7.1) — late
 * returns included — is there a real cost outlier (§7.4), does the fleet-mode
 * org demo assignments, and — the security-critical one — does a demo driver
 * account see exactly one vehicle?
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const seeder: any = await import("../../../scripts/seed-demo-fleet.mjs");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "garajim-demo-fleet-"));
const dbPath = path.join(tmpRoot, "demo.db");
const uploadsDir = path.join(tmpRoot, "uploads");
const RENTAL = "demo-fleet-org";
const COURIER = "demo-courier-org";
const PASSWORD = "GarajimDemo2026!";

let app: Express;
let ownerCookie: string;

/** Run the seeder without its (deliberately chatty) operator output. */
async function runSeeder(extra: string[] = []): Promise<void> {
  const log = console.log;
  console.log = () => {};
  try {
    await seeder.main(["--yes", "--db", dbPath, "--uploads", uploadsDir, "--no-verify", ...extra]);
  } finally {
    console.log = log;
  }
}

async function signIn(email: string): Promise<string> {
  const res = await request(app).post("/api/auth/sign-in/email").send({ email, password: PASSWORD });
  expect(res.status, `sign-in for ${email}`).toBe(200);
  return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
}

function userIdFor(email: string): string {
  const row = getDb().prepare("SELECT id FROM user WHERE email = ?").get(email) as { id: string };
  return row.id;
}

function scopedBikeIds(userId: string): string[] {
  const scope = bikeScope(userId, getDb());
  return (
    getDb()
      .prepare(`SELECT id FROM bike WHERE id IN (${scope.sql})`)
      .all(...scope.params) as { id: string }[]
  ).map((r) => r.id);
}

/** Google's encoded-polyline decoder, inlined: a test must not reach into apps/web. */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    for (const which of [0, 1] as const) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(i++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

beforeAll(async () => {
  resetDbForTests(dbPath);
  runMigrations();
  seedCatalog();
  closeDb();
  await runSeeder();
  resetDbForTests(dbPath);
  app = buildApp({ silent: true });
  ownerCookie = await signIn("demo@garajim.example");
}, 180_000);

afterAll(() => {
  closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("demo fleet", () => {
  describe("shape", () => {
    it("seeds one rental company and one own-fleet company, both clearly marked", () => {
      const orgs = getDb()
        .prepare("SELECT id, name, mode, max_vehicles FROM organization ORDER BY id")
        .all() as { id: string; name: string; mode: string; max_vehicles: number }[];
      expect(orgs.map((o) => o.id).sort()).toEqual([COURIER, RENTAL]);
      // Nobody must be able to confuse either with a paying customer.
      for (const o of orgs) expect(o.name).toMatch(/^DEMO/);
      expect(orgs.find((o) => o.id === RENTAL)!.mode).toBe("rental");
      expect(orgs.find((o) => o.id === COURIER)!.mode).toBe("fleet");

      for (const o of orgs) {
        const n = (
          getDb()
            .prepare("SELECT COUNT(*) n FROM bike WHERE org_id = ? AND archived = 0")
            .get(o.id) as { n: number }
        ).n;
        expect(n).toBeGreaterThanOrEqual(6);
        expect(o.max_vehicles).toBeGreaterThanOrEqual(n);
      }
    });

    it("uses real Turkish plate formats with real province codes", () => {
      const plates = (getDb().prepare("SELECT plate FROM bike").all() as { plate: string }[]).map(
        (r) => r.plate,
      );
      expect(plates.length).toBeGreaterThan(20);
      for (const plate of plates) {
        // "34 ABC 123" / "06 XY 1234" / "35 AB 123"
        expect(plate).toMatch(/^\d{2} [A-Z]{1,3} \d{2,4}$/);
        const province = Number(plate.slice(0, 2));
        expect(province).toBeGreaterThanOrEqual(1);
        expect(province).toBeLessThanOrEqual(81);
      }
      expect(new Set(plates).size).toBe(plates.length);
    });

    it("mixes cars and motorcycles, all resolvable in the vehicle catalog", () => {
      const rows = getDb()
        .prepare("SELECT vehicle_type, make, model, photo_url FROM bike")
        .all() as { vehicle_type: string; make: string; model: string; photo_url: string | null }[];
      expect(rows.some((r) => r.vehicle_type === "car")).toBe(true);
      expect(rows.some((r) => r.vehicle_type === "motorcycle")).toBe(true);

      // The seeded make/model must exist in the catalog, or the UI shows a
      // vehicle it cannot name.
      const lookup = getDb().prepare(
        `SELECT 1 FROM vehicle_model md JOIN vehicle_make mk ON mk.id = md.make_id
          WHERE mk.name = ? AND md.name = ?`,
      );
      for (const r of rows) {
        expect(lookup.get(r.make, r.model), `${r.make} ${r.model} missing from catalog`).toBeTruthy();
      }
      // No photos: we have none to license and will not ship fake ones. The UI
      // falls back to the vehicle-type glyph (web/src/lib/vehicleType.ts).
      for (const r of rows) expect(r.photo_url).toBeNull();
    });
  });

  describe("triage board (§7.1) through /api/orgs/:orgId/triage", () => {
    it("leads with genuinely overdue compliance on different vehicles", async () => {
      const res = await request(app)
        .get(`/api/orgs/${RENTAL}/triage`)
        .set("Cookie", ownerCookie);
      expect(res.status).toBe(200);
      const dated = res.body.overdue.filter((r: { kind: string }) => r.kind !== "contract_due");
      expect(dated.length).toBeGreaterThanOrEqual(2);
      expect(dated.length).toBeLessThanOrEqual(3);
      expect(new Set(dated.map((r: { plate: string }) => r.plate)).size).toBe(dated.length);
      for (const r of dated) expect(r.status).toBe("expired");
    });

    /**
     * The demo's headline for a rental company. A vehicle that has not come back
     * reaches the board through `contract_due` and is rendered with exactly the
     * urgency of an expired policy — same `expired` status, same negative
     * daysRemaining. That equivalence is the thing being pinned here.
     */
    it("puts late returns on the board with the same urgency as an expired document", async () => {
      const res = await request(app)
        .get(`/api/orgs/${RENTAL}/triage`)
        .set("Cookie", ownerCookie);
      const late = res.body.overdue.filter((r: { kind: string }) => r.kind === "contract_due");
      expect(late.length).toBeGreaterThanOrEqual(2);
      expect(late.length).toBeLessThanOrEqual(3);
      for (const r of late) {
        expect(r.status).toBe("expired");
        expect(r.daysRemaining).toBeLessThan(0);
        // The holder is the customer who still has it — the person to ring.
        expect(r.holder?.type).toBe("customer");
        expect(r.holder?.name).toBeTruthy();
      }
      // One badly overdue and one that has only just tipped over, so the board
      // shows a spread rather than a single number.
      const worst = Math.min(...late.map((r: { daysRemaining: number }) => r.daysRemaining));
      const mildest = Math.max(...late.map((r: { daysRemaining: number }) => r.daysRemaining));
      expect(worst).toBeLessThanOrEqual(-7);
      expect(mildest).toBeGreaterThanOrEqual(-2);
    });

    it("is mostly healthy — an all-red board reads as broken, an all-green one as pointless", async () => {
      const res = await request(app)
        .get(`/api/orgs/${RENTAL}/triage`)
        .set("Cookie", ownerCookie);
      expect(res.body.summary.overdueCount).toBeGreaterThan(0);
      expect(res.body.summary.totalVehicles).toBe(17);
      const flaggedVehicles = new Set(
        [...res.body.overdue, ...res.body.upcoming].map((r: { bikeId: string }) => r.bikeId),
      );
      expect(flaggedVehicles.size).toBeLessThan(res.body.summary.totalVehicles);
      expect(res.body.summary.documentsPendingOcr).toBeGreaterThan(0);
      expect(res.body.summary.idle).toBeGreaterThan(0);
    });

    it("gives the courier fleet a smaller board of its own", async () => {
      const res = await request(app)
        .get(`/api/orgs/${COURIER}/triage`)
        .set("Cookie", ownerCookie);
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe("fleet");
      expect(res.body.overdue.length).toBeGreaterThanOrEqual(1);
      expect(res.body.upcoming.length).toBeGreaterThanOrEqual(2);
      // A fleet-mode org has no contracts, so nothing on its board may be one.
      for (const r of [...res.body.overdue, ...res.body.upcoming]) {
        expect(r.kind).not.toBe("contract_due");
      }
      expect(res.body.summary.inUse).toBeGreaterThan(0);
      expect(res.body.summary.idle).toBeGreaterThan(0);
    });
  });

  describe("costs (§7.4) through /api/orgs/:orgId/costs", () => {
    it("has one obvious outlier in the rental fleet, well clear of the median", async () => {
      const res = await request(app)
        .get(`/api/orgs/${RENTAL}/costs`)
        .set("Cookie", ownerCookie);
      expect(res.status).toBe(200);
      expect(res.body.fleet.medianCostPerKm).toBeGreaterThan(0);
      const worst = res.body.vehicles[0];
      expect(worst.plate).toBe("34 KLM 226"); // the 2019 Transit
      expect(worst.outlier).toBe(true);
      expect(worst.ratioToMedian).toBeGreaterThan(2);
      // …and it must be a lone outlier, not half the fleet looking broken.
      const flagged = res.body.vehicles.filter((v: { outlier: boolean }) => v.outlier);
      expect(flagged).toHaveLength(1);
    });

    it("fills every month of the default 12-month window", async () => {
      const res = await request(app)
        .get(`/api/orgs/${RENTAL}/costs`)
        .set("Cookie", ownerCookie);
      expect(res.body.months).toHaveLength(12);
      // A chart with half its columns empty demos as missing data.
      for (const m of res.body.months) {
        expect(m.fuelCost, m.month).toBeGreaterThan(0);
        expect(m.distanceKm, m.month).toBeGreaterThan(0);
      }
      // Compliance is spread across the year rather than piled into the month
      // the seeder happened to run in.
      const withCompliance = res.body.months.filter(
        (m: { complianceCost: number }) => m.complianceCost > 0,
      );
      expect(withCompliance.length).toBeGreaterThanOrEqual(6);
    });

    it("prices fuel plausibly for Türkiye — ₺/L in a believable band", () => {
      const rows = getDb()
        .prepare("SELECT total_cost / liters AS unit FROM fuel_log")
        .all() as { unit: number }[];
      expect(rows.length).toBeGreaterThan(500);
      for (const r of rows) {
        expect(r.unit).toBeGreaterThan(40);
        expect(r.unit).toBeLessThan(70);
      }
    });

    /**
     * The pool scooter's fuel stopped being logged part-way through the year.
     * `/costs` is supposed to fall back to GPS trip distance rather than
     * report a blank — this is the only vehicle in the demo that exercises it.
     */
    it("falls back to trip distance for the vehicle whose fuel logging stopped", async () => {
      const res = await request(app)
        .get(`/api/orgs/${COURIER}/costs`)
        .set("Cookie", ownerCookie);
      const pool = res.body.vehicles.find((v: { plate: string }) => v.plate === "35 DR 224");
      expect(pool).toBeDefined();
      expect(pool.costPerKm).not.toBeNull();

      const bikeId = pool.bikeId;
      const lastFill = (
        getDb().prepare("SELECT MAX(filled_on) m FROM fuel_log WHERE bike_id = ?").get(bikeId) as {
          m: string | null;
        }
      ).m!;
      expect(lastFill).toBeTruthy();
      // Months after the last fill still report distance, and it can only have
      // come from trips.
      const orphanMonths = pool.months.filter(
        (m: { month: string; distanceKm: number; fuelCost: number }) =>
          m.month > lastFill.slice(0, 7) && m.distanceKm > 0,
      );
      expect(orphanMonths.length).toBeGreaterThanOrEqual(1);
      for (const m of orphanMonths) expect(m.fuelCost).toBe(0);
      // And the resulting ₺/km is a sane number, not an artefact of a token
      // sample of trips against a year of premiums.
      expect(pool.costPerKm).toBeGreaterThan(1);
      expect(pool.costPerKm).toBeLessThan(res.body.fleet.medianCostPerKm * 1.5);
    });
  });

  describe("trips", () => {
    it("records journeys on both fleets, with encoded routes", () => {
      const rows = getDb()
        .prepare(
          `SELECT t.id, t.distance_km, t.route, t.point_count, t.started_at, t.ended_at,
                  b.org_id, b.plate
             FROM trip t JOIN bike b ON b.id = t.bike_id`,
        )
        .all() as {
        distance_km: number;
        route: string;
        point_count: number;
        started_at: string;
        ended_at: string;
        org_id: string;
        plate: string;
      }[];
      expect(rows.length).toBeGreaterThanOrEqual(25);
      expect(rows.some((r) => r.org_id === RENTAL)).toBe(true);
      expect(rows.some((r) => r.org_id === COURIER)).toBe(true);
      for (const r of rows) {
        // tripCreateSchema refuses anything under 15 km, so a seeded trip that
        // short could never have been created through the API.
        expect(r.distance_km).toBeGreaterThanOrEqual(15);
        expect(r.point_count).toBeGreaterThan(0);
        expect(r.route).toBeTruthy();
        expect(Date.parse(r.ended_at)).toBeGreaterThan(Date.parse(r.started_at));
      }
    });

    it("puts each route on real roads in the vehicle's own province", () => {
      const rows = getDb()
        .prepare(
          `SELECT t.route, t.distance_km, b.plate FROM trip t JOIN bike b ON b.id = t.bike_id`,
        )
        .all() as { route: string; distance_km: number; plate: string }[];
      // 07 = Antalya, 35 = İzmir. Boxes are tight enough that a route wandering
      // into the sea or the next province fails.
      const BOX: Record<string, [number, number, number, number]> = {
        antalya: [36.55, 30.45, 36.96, 31.12],
        izmir: [38.1, 26.98, 38.55, 27.45],
      };
      for (const r of rows) {
        const region = r.plate.startsWith("35") || r.plate.startsWith("34") ? null : "antalya";
        const box = BOX[region ?? "izmir"]!;
        const pts = decodePolyline(r.route);
        expect(pts.length).toBeGreaterThan(30);
        for (const [lat, lng] of pts) {
          expect(lat, `${r.plate} lat`).toBeGreaterThanOrEqual(box[0]);
          expect(lat, `${r.plate} lat`).toBeLessThanOrEqual(box[2]);
          expect(lng, `${r.plate} lng`).toBeGreaterThanOrEqual(box[1]);
          expect(lng, `${r.plate} lng`).toBeLessThanOrEqual(box[3]);
        }
        // The stored distance must match the geometry, or the costs fallback is
        // reporting a number the map contradicts.
        let km = 0;
        for (let i = 1; i < pts.length; i++) {
          const [aLat, aLng] = pts[i - 1]!;
          const [bLat, bLng] = pts[i]!;
          const dLat = ((bLat - aLat) * Math.PI) / 180;
          const dLng = ((bLng - aLng) * Math.PI) / 180;
          const h =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
          km += 2 * 6371 * Math.asin(Math.sqrt(h));
        }
        expect(Math.abs(km - r.distance_km)).toBeLessThan(0.5);
      }
    });

    it("attributes every trip to someone who was holding the vehicle", () => {
      // A manager can see a driver's routes; a driver could only ever have
      // recorded one on a vehicle in their hands. Nothing here could have been
      // written through the API by the person it is attributed to otherwise.
      const bad = getDb()
        .prepare(
          `SELECT COUNT(*) n
             FROM trip t
             JOIN bike b ON b.id = t.bike_id
             JOIN org_member m ON m.org_id = b.org_id AND m.user_id = t.user_id AND m.status = 'active'
            WHERE m.role = 'driver'
              AND NOT EXISTS (
                SELECT 1 FROM vehicle_assignment va
                 WHERE va.bike_id = t.bike_id AND va.user_id = t.user_id
                   AND date(va.started_at) <= date(t.started_at)
                   AND (va.ended_at IS NULL OR date(va.ended_at) >= date(t.started_at)))`,
        )
        .get() as { n: number };
      expect(bad.n).toBe(0);
    });
  });

  describe("the fleet-mode org (assignments)", () => {
    it("has vehicles out with drivers, vehicles idle, and closed assignments in the history", async () => {
      const res = await request(app)
        .get(`/api/orgs/${COURIER}/assignments`)
        .set("Cookie", ownerCookie);
      expect(res.status).toBe(200);
      const open = res.body.filter((a: { endedAt: string | null }) => a.endedAt === null);
      const closed = res.body.filter((a: { endedAt: string | null }) => a.endedAt !== null);
      expect(open.length).toBeGreaterThanOrEqual(3);
      expect(closed.length).toBeGreaterThanOrEqual(2);
      // One vehicle cannot be in two pairs of hands at once.
      expect(new Set(open.map((a: { bikeId: string }) => a.bikeId)).size).toBe(open.length);
      for (const a of closed) {
        expect(a.endKm).toBeGreaterThan(a.startKm);
      }
      const vehicles = (
        getDb().prepare("SELECT COUNT(*) n FROM bike WHERE org_id = ?").get(COURIER) as { n: number }
      ).n;
      expect(open.length).toBeLessThan(vehicles); // something has to be idle
    });

    it("shows the holder as a driver, not a customer", async () => {
      const res = await request(app)
        .get(`/api/orgs/${COURIER}/vehicles`)
        .set("Cookie", ownerCookie);
      expect(res.status).toBe(200);
      const held = res.body.items.filter((r: { holder: unknown }) => r.holder !== null);
      expect(held.length).toBeGreaterThanOrEqual(3);
      for (const r of held) expect(r.holder.type).toBe("driver");
    });
  });

  describe("people (§7.5) and contracts (§7.6)", () => {
    it("has a member in each of the four roles in the rental org", () => {
      const roles = (
        getDb()
          .prepare("SELECT role FROM org_member WHERE org_id = ? AND status = 'active'")
          .all(RENTAL) as { role: string }[]
      ).map((r) => r.role);
      expect(new Set(roles)).toEqual(new Set(["owner", "manager", "staff", "driver"]));
    });

    it("has open, late and closed contracts, with handover and return km", () => {
      const rows = getDb()
        .prepare(
          "SELECT status, ends_at, handover_km, return_km, daily_rate FROM rental_contract WHERE org_id = ?",
        )
        .all(RENTAL) as {
        status: string;
        ends_at: string;
        handover_km: number | null;
        return_km: number | null;
        daily_rate: number;
      }[];
      const open = rows.filter((r) => r.status === "open");
      const closed = rows.filter((r) => r.status === "returned");
      expect(open.length).toBeGreaterThanOrEqual(3);
      expect(closed.length).toBeGreaterThanOrEqual(10);
      expect(open.filter((r) => r.ends_at < new Date().toISOString().slice(0, 10)).length).toBe(3);
      for (const r of rows) {
        expect(r.handover_km).toBeGreaterThan(0);
        expect(r.daily_rate).toBeGreaterThan(0);
      }
      for (const r of closed) expect(r.return_km!).toBeGreaterThan(r.handover_km!);
      for (const r of open) expect(r.return_km).toBeNull();
    });

    it("keeps every rental contract inside the vehicle's real odometer history", () => {
      const bad = getDb()
        .prepare(
          `SELECT COUNT(*) n FROM rental_contract rc JOIN bike b ON b.id = rc.bike_id
            WHERE rc.handover_km > b.current_km OR rc.return_km > b.current_km`,
        )
        .get() as { n: number };
      expect(bad.n).toBe(0);
    });

    it("has customers that are people and companies, with contact details", () => {
      const rows = getDb()
        .prepare("SELECT name, phone, email FROM fleet_customer WHERE org_id = ?")
        .all(RENTAL) as { name: string; phone: string; email: string }[];
      expect(rows.length).toBeGreaterThanOrEqual(6);
      expect(rows.some((r) => /Ltd\. Şti\.|A\.Ş\./.test(r.name))).toBe(true);
      for (const r of rows) expect(r.phone).toMatch(/^\+90 /);
    });
  });

  describe("document wallet (§7.3)", () => {
    it("has documents in both orgs whose files really exist on disk", () => {
      for (const orgId of [RENTAL, COURIER]) {
        const docs = getDb()
          .prepare(
            `SELECT file_path, size_bytes, ocr_status, ocr_model FROM document
              WHERE bike_id IN (SELECT id FROM bike WHERE org_id = ?)`,
          )
          .all(orgId) as {
          file_path: string;
          size_bytes: number;
          ocr_status: string;
          ocr_model: string | null;
        }[];
        expect(docs.length, orgId).toBeGreaterThanOrEqual(4);
        for (const d of docs) {
          expect(fs.existsSync(d.file_path), d.file_path).toBe(true);
          expect(fs.statSync(d.file_path).size).toBe(d.size_bytes);
          // Org scans live under org/<orgId>, never in a member's own directory
          // — that is what survives a member deleting their account.
          expect(d.file_path).toContain(path.join("org", orgId));
        }
        // Provenance is honest: nothing claims a model produced these.
        for (const d of docs.filter((x) => x.ocr_status === "done")) {
          expect(d.ocr_model).toBe("demo-seed");
        }
        expect(docs.filter((d) => d.ocr_status === "pending").length).toBeGreaterThan(0);
      }
    });
  });

  describe("the demo accounts", () => {
    it("signs in through the real auth route with the printed credentials", async () => {
      const res = await request(app)
        .post("/api/auth/sign-in/email")
        .send({ email: "demo@garajim.example", password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("demo@garajim.example");
    });

    it("rejects a wrong password — the hash is real, not a placeholder", async () => {
      const res = await request(app)
        .post("/api/auth/sign-in/email")
        .send({ email: "demo@garajim.example", password: "not-the-demo-password" });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("gives the owner both fleets from one sign-in", () => {
      const ownerId = userIdFor("demo@garajim.example");
      const orgs = userOrgs(ownerId, getDb());
      expect(orgs.map((o) => o.orgId).sort()).toEqual([COURIER, RENTAL]);
      for (const o of orgs) expect(o.role).toBe("owner");
      expect(scopedBikeIds(ownerId)).toHaveLength(24); // 17 + 7
    });

    /**
     * The security-critical demo. A driver must not be able to enumerate the
     * fleet, and this is the account a prospect (or a reviewer) will try it on.
     */
    it("gives the rental driver exactly the one vehicle in their hands", async () => {
      const driverId = userIdFor("demo.sofor@garajim.example");
      expect(scopedBikeIds(driverId)).toHaveLength(1);

      const cookie = await signIn("demo.sofor@garajim.example");
      const bikes = await request(app).get("/api/bikes").set("Cookie", cookie);
      expect(bikes.status).toBe(200);
      expect(bikes.body).toHaveLength(1);
      expect(bikes.body[0].plate).toBe("07 JR 806");

      // …and no fleet-wide screen at all, in either org.
      for (const orgId of [RENTAL, COURIER]) {
        const triage = await request(app)
          .get(`/api/orgs/${orgId}/triage`)
          .set("Cookie", cookie);
        expect([403, 404]).toContain(triage.status);
      }
    });

    it("gives each courier driver exactly their own vehicle", async () => {
      for (const email of ["demo.kurye1", "demo.kurye2", "demo.kurye3"]) {
        const id = userIdFor(`${email}@garajim.example`);
        expect(scopedBikeIds(id), email).toHaveLength(1);
      }
      const cookie = await signIn("demo.kurye1@garajim.example");
      const bikes = await request(app).get("/api/bikes").set("Cookie", cookie);
      expect(bikes.body).toHaveLength(1);
      expect(bikes.body[0].plate).toBe("35 ABK 417");
    });
  });

  describe("re-running", () => {
    it("resets and reseeds instead of duplicating", async () => {
      const snapshot = () =>
        getDb()
          .prepare(
            `SELECT (SELECT COUNT(*) FROM bike) b, (SELECT COUNT(*) FROM fuel_log) f,
                    (SELECT COUNT(*) FROM rental_contract) c, (SELECT COUNT(*) FROM user) u,
                    (SELECT COUNT(*) FROM trip) t, (SELECT COUNT(*) FROM vehicle_assignment) a,
                    (SELECT COUNT(*) FROM organization) o, (SELECT COUNT(*) FROM document) d,
                    (SELECT ROUND(SUM(total_cost), 2) FROM fuel_log) fc,
                    (SELECT ROUND(SUM(distance_km), 2) FROM trip) tk`,
          )
          .get() as Record<string, number>;
      const before = snapshot();
      closeDb();
      await runSeeder();
      resetDbForTests(dbPath);
      // Byte-identical, not merely the same size: the generator is seeded, so a
      // re-run before a demo must not quietly change the numbers on the board.
      expect(snapshot()).toEqual(before);
    }, 180_000);

    it("refuses to run at all without --yes", async () => {
      await expect(seeder.main(["--db", dbPath])).rejects.toThrow(/--yes/);
    });
  });
});
