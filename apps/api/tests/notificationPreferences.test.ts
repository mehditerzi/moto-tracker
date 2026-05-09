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
    expect(res.body.leadDays).toEqual([60, 14, 7, 1]);
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
