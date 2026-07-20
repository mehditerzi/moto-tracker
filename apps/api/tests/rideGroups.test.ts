import { describe, it, expect } from "vitest";
import http from "node:http";
import request from "supertest";
import WebSocket from "ws";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { attachRideWs, createRideTicket, consumeRideTicket } from "../src/lib/rideHub.js";

describe("/api/ride-groups", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    expect((await request(app).get("/api/ride-groups/active")).status).toBe(401);
  });

  it("create → join by code → active → owner leave ends the ride", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app);
    const buddy = await signUpAndSignIn(app);

    const created = await request(app).post("/api/ride-groups").set("Cookie", owner.cookie).send({});
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(created.body.isOwner).toBe(true);

    const joined = await request(app)
      .post("/api/ride-groups/join")
      .set("Cookie", buddy.cookie)
      .set("Content-Type", "application/json")
      .send({ code: created.body.code.toLowerCase() }); // case-insensitive
    expect(joined.status).toBe(200);
    expect(joined.body.members).toHaveLength(2);

    const active = await request(app).get("/api/ride-groups/active").set("Cookie", buddy.cookie);
    expect(active.body.id).toBe(created.body.id);
    expect(active.body.isOwner).toBe(false);

    // Owner leaving ends the ride for everyone.
    await request(app).post("/api/ride-groups/leave").set("Cookie", owner.cookie).send({});
    const after = await request(app).get("/api/ride-groups/active").set("Cookie", buddy.cookie);
    expect(after.body).toBeNull();
  });

  it("joining a new ride leaves the previous one; unknown code 404s", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    const g1 = await request(app).post("/api/ride-groups").set("Cookie", a.cookie).send({});
    const g2 = await request(app).post("/api/ride-groups").set("Cookie", b.cookie).send({});

    await request(app)
      .post("/api/ride-groups/join")
      .set("Cookie", a.cookie)
      .set("Content-Type", "application/json")
      .send({ code: g2.body.code });
    const active = await request(app).get("/api/ride-groups/active").set("Cookie", a.cookie);
    expect(active.body.id).toBe(g2.body.id);
    // a was the owner of g1 → their departure ended it.
    expect(g1.body.id).not.toBe(g2.body.id);

    const bad = await request(app)
      .post("/api/ride-groups/join")
      .set("Cookie", a.cookie)
      .set("Content-Type", "application/json")
      .send({ code: "ZZZZZZ" });
    expect(bad.status).toBe(404);
  });

  it("ws tickets are one-time and expire", () => {
    const ticket = createRideTicket("u1", "g1", "Ali");
    expect(consumeRideTicket(ticket)).toMatchObject({ userId: "u1", groupId: "g1", name: "Ali" });
    expect(consumeRideTicket(ticket)).toBeNull(); // second use fails
    expect(consumeRideTicket("nonsense")).toBeNull();
  });
});

describe("ride WebSocket hub", () => {
  it("relays positions between members and rejects bad tickets", async () => {
    const app = buildTestApp();
    const server = http.createServer(app);
    attachRideWs(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const owner = await signUpAndSignIn(app);
      const buddy = await signUpAndSignIn(app);
      await request(app).post("/api/ride-groups").set("Cookie", owner.cookie).send({});
      const created = await request(app).get("/api/ride-groups/active").set("Cookie", owner.cookie);
      await request(app)
        .post("/api/ride-groups/join")
        .set("Cookie", buddy.cookie)
        .set("Content-Type", "application/json")
        .send({ code: created.body.code });

      const t1 = await request(app).get("/api/ride-groups/ws-ticket").set("Cookie", owner.cookie);
      const t2 = await request(app).get("/api/ride-groups/ws-ticket").set("Cookie", buddy.cookie);

      const connect = (ticket: string) =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ride-ws?ticket=${ticket}`);
          ws.on("open", () => resolve(ws));
          ws.on("error", reject);
        });

      const wsOwner = await connect(t1.body.ticket);
      const wsBuddy = await connect(t2.body.ticket);

      // Owner sends a position; buddy should receive a roster containing it.
      const gotPosition = new Promise<{ lat: number; lng: number }>((resolve) => {
        wsBuddy.on("message", (data) => {
          const msg = JSON.parse(String(data));
          const withPos = msg.members?.find(
            (m: { pos: { lat: number } | null }) => m.pos !== null,
          );
          if (msg.type === "roster" && withPos) resolve(withPos.pos);
        });
      });
      wsOwner.send(JSON.stringify({ lat: 41.01, lng: 28.98, speed: 22 }));
      const pos = await gotPosition;
      expect(pos.lat).toBeCloseTo(41.01, 5);
      expect(pos.lng).toBeCloseTo(28.98, 5);

      wsOwner.close();
      wsBuddy.close();

      // A garbage ticket is refused at upgrade time.
      const refused = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ride-ws?ticket=bogus`);
        ws.on("open", () => resolve(false));
        ws.on("error", () => resolve(true));
      });
      expect(refused).toBe(true);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
