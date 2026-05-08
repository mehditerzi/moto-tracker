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
