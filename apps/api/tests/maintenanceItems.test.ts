import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { getDb } from "../src/db/index.js";

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

  it("accepts every maintenance kind allowed by the shared schema", async () => {
    // Regression: the DB CHECK constraint once lagged the zod schema, so
    // 'battery' and 'air_filter' passed validation but 500'd at insert.
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "all-kinds" });
    const bikeId = bike.body.id;
    const kinds = [
      "engine_oil",
      "brakes",
      "tires",
      "battery",
      "coolant",
      "air_filter",
      "chain",
      "custom",
    ];
    for (const kind of kinds) {
      const res = await request(app)
        .post(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie)
        .send({ kind, ...(kind === "custom" ? { customLabel: "Fren hidroliği" } : {}) });
      expect(res.status, `kind=${kind}`).toBe(201);
      expect(res.body.kind).toBe(kind);
    }
  });

  /**
   * What a service job cost is the maintenance half of the fleet cost-per-vehicle
   * rollup (docs/fleet-design.md §7.4, routes/orgFleet.ts). The column existed
   * from migration 023 but nothing wrote it, so the bucket was permanently 0 —
   * these pin the whole write path shut.
   */
  describe("cost", () => {
    async function bikeFor(app: ReturnType<typeof buildTestApp>, cookie: string) {
      const bike = await request(app)
        .post("/api/bikes")
        .set("Cookie", cookie)
        .send({ nickname: "Servis" });
      return bike.body.id as string;
    }

    it("round-trips on create, on read and on patch", async () => {
      const app = buildTestApp();
      const { cookie } = await signUpAndSignIn(app, "cost-create@test.com");
      const bikeId = await bikeFor(app, cookie);

      const create = await request(app)
        .post(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie)
        .send({ kind: "engine_oil", lastDoneOn: "2026-03-04", cost: 2450.75 });
      expect(create.status).toBe(201);
      expect(create.body.cost).toBe(2450.75);

      const read = await request(app)
        .get(`/api/maintenance-items/${create.body.id}`)
        .set("Cookie", cookie);
      expect(read.body.cost).toBe(2450.75);

      const list = await request(app)
        .get(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie);
      expect(list.body[0].cost).toBe(2450.75);

      const patch = await request(app)
        .patch(`/api/maintenance-items/${create.body.id}`)
        .set("Cookie", cookie)
        .send({ cost: 3100 });
      expect(patch.status).toBe(200);
      expect(patch.body.cost).toBe(3100);

      // …and it must be clearable again — a cost entered by mistake has to go.
      const cleared = await request(app)
        .patch(`/api/maintenance-items/${create.body.id}`)
        .set("Cookie", cookie)
        .send({ cost: null });
      expect(cleared.body.cost).toBeNull();
    });

    it("is optional — omitting it stores null, and a patch that omits it leaves it alone", async () => {
      const app = buildTestApp();
      const { cookie } = await signUpAndSignIn(app, "cost-optional@test.com");
      const bikeId = await bikeFor(app, cookie);

      const create = await request(app)
        .post(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie)
        .send({ kind: "brakes" });
      expect(create.status).toBe(201);
      expect(create.body).toHaveProperty("cost", null);

      const withCost = await request(app)
        .patch(`/api/maintenance-items/${create.body.id}`)
        .set("Cookie", cookie)
        .send({ cost: 500 });
      expect(withCost.body.cost).toBe(500);

      // An unrelated patch must not silently wipe the cost.
      const other = await request(app)
        .patch(`/api/maintenance-items/${create.body.id}`)
        .set("Cookie", cookie)
        .send({ notes: "balata değişti" });
      expect(other.body.cost).toBe(500);
    });

    it("rejects a negative cost on create and on patch", async () => {
      const app = buildTestApp();
      const { cookie } = await signUpAndSignIn(app, "cost-negative@test.com");
      const bikeId = await bikeFor(app, cookie);

      const bad = await request(app)
        .post(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie)
        .send({ kind: "tires", cost: -1 });
      expect(bad.status).toBe(400);

      const ok = await request(app)
        .post(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie)
        .send({ kind: "tires", cost: 0 });
      expect(ok.status).toBe(201);
      expect(ok.body.cost).toBe(0);

      const badPatch = await request(app)
        .patch(`/api/maintenance-items/${ok.body.id}`)
        .set("Cookie", cookie)
        .send({ cost: -0.01 });
      expect(badPatch.status).toBe(400);
    });

    /**
     * The reason the field exists. orgFleet.ts sums `COALESCE(cost, 0)` bucketed
     * by `substr(last_done_on, 1, 7)` — so a cost only reaches the report when
     * the record also carries a last-done date. Assert against that exact query
     * so a rename on either side is caught here.
     */
    it("lands in the column the fleet cost rollup reads", async () => {
      const app = buildTestApp();
      const { cookie } = await signUpAndSignIn(app, "cost-rollup@test.com");
      const bikeId = await bikeFor(app, cookie);

      await request(app)
        .post(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie)
        .send({ kind: "engine_oil", lastDoneOn: "2026-03-04", cost: 1200 });
      await request(app)
        .post(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie)
        .send({ kind: "brakes", lastDoneOn: "2026-03-20", cost: 800.5 });

      const row = getDb()
        .prepare(
          `SELECT bike_id, substr(last_done_on, 1, 7) AS month, SUM(COALESCE(cost, 0)) AS total
             FROM maintenance_item
            WHERE bike_id = ? AND last_done_on IS NOT NULL
            GROUP BY bike_id, month`,
        )
        .get(bikeId) as { month: string; total: number };
      expect(row.month).toBe("2026-03");
      expect(row.total).toBe(2000.5);
    });
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
