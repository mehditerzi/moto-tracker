import { describe, it, expect } from "vitest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import request from "supertest";

describe("/api/me", () => {
  it("returns user + profile after sign-up (auto-creates profile with tr default)", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.profile.language).toBe("tr");
    expect(res.body.profile.timezone).toBe("Europe/Istanbul");
  });

  it("PATCH /api/me updates language", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ language: "en" });
    expect(res.status).toBe(200);
    expect(res.body.language).toBe("en");
  });
});
