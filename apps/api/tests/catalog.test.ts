import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/catalog", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/catalog/makes");
    expect(res.status).toBe(401);
  });

  it("searches makes by query", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/catalog/makes?q=yam").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Yamaha");
  });

  it("filters makes by vehicle type", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const cars = await request(app).get("/api/catalog/makes?q=fiat&type=car").set("Cookie", cookie);
    expect(cars.body).toContain("Fiat");
    // A car-only brand should not appear under motorcycle.
    const moto = await request(app).get("/api/catalog/makes?q=fiat&type=motorcycle").set("Cookie", cookie);
    expect(moto.body).not.toContain("Fiat");
  });

  it("returns models for a make, type-scoped", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const moto = await request(app)
      .get("/api/catalog/models?make=Honda&type=motorcycle")
      .set("Cookie", cookie);
    expect(moto.body.some((m: string) => /CB|CBR|PCX/.test(m))).toBe(true);
    const cars = await request(app)
      .get("/api/catalog/models?make=Honda&type=car&q=civ")
      .set("Cookie", cookie);
    expect(cars.body).toContain("Civic");
  });

  it("still matches mid-word substrings through the FTS path (3+ chars)", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    // "dav" only appears in the middle of "Harley-Davidson" → this is the case
    // the trigram index has to answer exactly like the old full scan did.
    const mid = await request(app).get("/api/catalog/makes?q=dav").set("Cookie", cookie);
    expect(mid.status).toBe(200);
    expect(mid.body.some((n: string) => /davidson/i.test(n))).toBe(true);
    // 1–2 character queries take the plain scan and must behave the same.
    const short = await request(app).get("/api/catalog/makes?q=ya").set("Cookie", cookie);
    expect(short.body).toContain("Yamaha");
  });

  it("ranks an exact match first, then prefix matches", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/catalog/makes?q=honda").set("Cookie", cookie);
    expect(res.body[0]).toBe("Honda");
  });

  it("resolves models via make alias", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/catalog/models?make=harley").set("Cookie", cookie);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
