import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/events", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/events")
      .send({ events: [{ name: "scan_started" }] });
    expect(res.status).toBe(401);
  });

  it("accepts a batch and reports the count", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/events")
      .set("Cookie", cookie)
      .send({
        events: [
          { name: "scan_started", props: { hasBike: true }, sessionId: "s1", ts: "2026-06-29T10:00:00.000Z" },
          { name: "review_applied", props: { fields: 3, edited: 1 }, sessionId: "s1" },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 2 });
  });

  it("rejects an empty or malformed batch", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const empty = await request(app).post("/api/events").set("Cookie", cookie).send({ events: [] });
    expect(empty.status).toBe(400);
    const noName = await request(app)
      .post("/api/events")
      .set("Cookie", cookie)
      .send({ events: [{ props: { a: 1 } }] });
    expect(noName.status).toBe(400);
  });
});
