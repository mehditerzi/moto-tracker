import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import request from "supertest";
import WebSocket from "ws";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import {
  attachRideWs,
  createRideTicket,
  consumeRideTicket,
  sweepExpiredTickets,
  pendingTicketCount,
} from "../src/lib/rideHub.js";
import { pruneStaleGroups } from "../src/routes/rideGroups.js";
import { getDb } from "../src/db/index.js";

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

  it("unconsumed tickets are swept once expired", () => {
    sweepExpiredTickets(); // clear anything other tests left behind
    const before = pendingTicketCount();
    for (let i = 0; i < 50; i++) createRideTicket(`u${i}`, "g1", "Ali");
    expect(pendingTicketCount()).toBe(before + 50);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 5 * 60_000); // past TICKET_TTL_MS
      expect(sweepExpiredTickets()).toBeGreaterThanOrEqual(50);
    } finally {
      vi.useRealTimers();
    }
    expect(pendingTicketCount()).toBe(0);
  });

  it("codes stay in the alphabet, are unique, and cover it broadly", async () => {
    const app = buildTestApp();
    const user = await signUpAndSignIn(app);
    const seen = new Set<string>();
    const letters = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const g = await request(app).post("/api/ride-groups").set("Cookie", user.cookie).send({});
      expect(g.status).toBe(201);
      expect(g.body.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
      seen.add(g.body.code);
      for (const ch of g.body.code as string) letters.add(ch);
    }
    expect(seen.size).toBe(40); // 40 inserts, 40 distinct codes past UNIQUE(code)
    // 240 draws over a 31-letter alphabet should touch most of it.
    expect(letters.size).toBeGreaterThan(20);
  });

  it("prunes groups that are past their useful life", async () => {
    const app = buildTestApp();
    const user = await signUpAndSignIn(app);
    const fresh = await request(app).post("/api/ride-groups").set("Cookie", user.cookie).send({});
    const db = getDb();

    // Two dead rows: one aged out, one ended long enough ago to drop.
    db.prepare(
      `INSERT INTO ride_group (id, owner_id, code, created_at) VALUES (?, ?, ?, datetime('now','-72 hours'))`,
    ).run("g_old", user.user.id, "OLDOLD");
    db.prepare(
      `INSERT INTO ride_group (id, owner_id, code, created_at, ended_at)
       VALUES (?, ?, ?, datetime('now','-3 hours'), datetime('now','-2 hours'))`,
    ).run("g_ended", user.user.id, "ENDEND");
    db.prepare("INSERT INTO ride_member (group_id, user_id) VALUES (?, ?)").run(
      "g_old",
      user.user.id,
    );

    pruneStaleGroups();

    const left = db.prepare("SELECT id FROM ride_group ORDER BY id").all() as { id: string }[];
    expect(left.map((r) => r.id)).toEqual([fresh.body.id]);
    // ride_member follows via ON DELETE CASCADE.
    const orphans = db
      .prepare("SELECT COUNT(*) AS n FROM ride_member WHERE group_id = 'g_old'")
      .get() as { n: number };
    expect(orphans.n).toBe(0);
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

  it("answers non-ride upgrades instead of leaking the socket, and caps frame size", async () => {
    const app = buildTestApp();
    const server = http.createServer(app);
    const hub = attachRideWs(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      // An upgrade to an unknown path must get a response and be closed, not
      // held open until the TCP timeout.
      const rejected = await new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/some/other/path`);
        ws.on("open", () => resolve("opened"));
        ws.on("error", (e: Error) => resolve(e.message));
      });
      expect(rejected).toMatch(/404/);

      // A frame past maxPayload closes the socket (1009) rather than being
      // buffered — ws would otherwise allow up to 100 MiB.
      const ticket = createRideTicket("u_big", "g_big", "Ali");
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const s = new WebSocket(`ws://127.0.0.1:${port}/api/ride-ws?ticket=${ticket}`);
        s.on("open", () => resolve(s));
        s.on("error", reject);
      });
      const closeCode = await new Promise<number>((resolve) => {
        ws.on("close", (code: number) => resolve(code));
        ws.send(JSON.stringify({ lat: 41, lng: 29, pad: "x".repeat(64 * 1024) }));
      });
      expect(closeCode).toBe(1009); // "message too big"
    } finally {
      await hub.close();
      await new Promise((r) => server.close(r));
    }
  });

  it("drops position frames past the per-socket ingress cap", async () => {
    const app = buildTestApp();
    const server = http.createServer(app);
    const hub = attachRideWs(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const connect = (ticket: string) =>
        new Promise<WebSocket>((resolve, reject) => {
          const s = new WebSocket(`ws://127.0.0.1:${port}/api/ride-ws?ticket=${ticket}`);
          s.on("open", () => resolve(s));
          s.on("error", reject);
        });
      const flooder = await connect(createRideTicket("u_flood", "g_rate", "Flooder"));
      const watcher = await connect(createRideTicket("u_watch", "g_rate", "Watcher"));

      let lastLat: number | null = null;
      watcher.on("message", (data: unknown) => {
        const msg = JSON.parse(String(data)) as {
          type: string;
          members?: { userId: string; pos: { lat: number } | null }[];
        };
        const flood = msg.members?.find((m) => m.userId === "u_flood");
        if (flood?.pos) lastLat = flood.pos.lat;
      });

      // 400 frames in one window: past MSG_ABUSE_PER_WINDOW (300) the socket is
      // closed with 1008, and nothing past MSG_MAX_PER_WINDOW (30) is applied.
      const closed = new Promise<number>((resolve) => flooder.on("close", (c: number) => resolve(c)));
      for (let i = 0; i < 400; i++) flooder.send(JSON.stringify({ lat: 40 + i / 1000, lng: 29 }));
      expect(await closed).toBe(1008);

      // Give the throttled broadcast a beat to land.
      await new Promise((r) => setTimeout(r, 1200));
      // The 30th frame is lat 40.029; anything later must have been dropped.
      if (lastLat !== null) expect(lastLat).toBeLessThanOrEqual(40.03);
      watcher.close();
    } finally {
      await hub.close();
      await new Promise((r) => server.close(r));
    }
  });
});
