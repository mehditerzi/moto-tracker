import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/push/device-token", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/push/device-token")
      .send({ platform: "ios", token: "abcd1234efgh" });
    expect(res.status).toBe(401);
  });

  it("creates then upserts a device token", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const first = await request(app)
      .post("/api/push/device-token")
      .set("Cookie", cookie)
      .send({ platform: "ios", token: "tok-aaaaaaaa" });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe("created");

    const second = await request(app)
      .post("/api/push/device-token")
      .set("Cookie", cookie)
      .send({ platform: "ios", token: "tok-aaaaaaaa" });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("updated");
  });

  it("rejects an invalid payload", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/push/device-token")
      .set("Cookie", cookie)
      .send({ platform: "android", token: "x" });
    expect(res.status).toBe(400);
  });

  it("removes a device token", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await request(app)
      .post("/api/push/device-token")
      .set("Cookie", cookie)
      .send({ platform: "ios", token: "tok-bbbbbbbb" });
    const del = await request(app)
      .post("/api/push/device-token/remove")
      .set("Cookie", cookie)
      .send({ token: "tok-bbbbbbbb" });
    expect(del.status).toBe(204);
  });
});
