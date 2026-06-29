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

  it("accepts the mtv (vehicle tax) type", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie);
    const create = await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ type: "mtv", expiresOn: "2027-01-31" });
    expect(create.status).toBe(201);
    expect(create.body.type).toBe("mtv");
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
