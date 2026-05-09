import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import {
  __setSendForTests,
  __resetSendForTests,
} from "../src/notify/webPushClient.js";

describe("/api/push", () => {
  beforeEach(() => {
    __setSendForTests(async () => ({ ok: true as const }));
  });
  afterEach(() => {
    __resetSendForTests();
  });

  it("subscribe + unsubscribe", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const sub = await request(app)
      .post("/api/push/subscribe")
      .set("Cookie", cookie)
      .send({
        endpoint: "https://fcm.example/abc",
        keys: { p256dh: "P256", auth: "AUTH" },
      });
    expect(sub.status).toBe(201);
    const dup = await request(app)
      .post("/api/push/subscribe")
      .set("Cookie", cookie)
      .send({
        endpoint: "https://fcm.example/abc",
        keys: { p256dh: "P256X", auth: "AUTH" },
      });
    expect(dup.status).toBe(200);
    const off = await request(app)
      .post("/api/push/unsubscribe")
      .set("Cookie", cookie)
      .send({ endpoint: "https://fcm.example/abc" });
    expect(off.status).toBe(204);
  });

  it("test fanout calls sendPush for each subscription", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    let calls = 0;
    __setSendForTests(async () => {
      calls += 1;
      return { ok: true as const };
    });
    await request(app)
      .post("/api/push/subscribe")
      .set("Cookie", cookie)
      .send({
        endpoint: "https://fcm.example/a",
        keys: { p256dh: "P", auth: "A" },
      });
    await request(app)
      .post("/api/push/subscribe")
      .set("Cookie", cookie)
      .send({
        endpoint: "https://fcm.example/b",
        keys: { p256dh: "P", auth: "A" },
      });
    const r = await request(app).post("/api/push/test").set("Cookie", cookie);
    expect(r.body).toEqual({ sent: 2, total: 2 });
    expect(calls).toBe(2);
  });
});
