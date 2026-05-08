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

    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .send({ type: "sigorta", expiresOn: "2025-03-01" });
    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .send({ type: "sigorta", expiresOn: "2027-03-01" });
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
