import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { getDb } from "../src/db/index.js";
import { remindUpcomingRides } from "../src/routes/rideEvents.js";

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const plan = (over: Record<string, unknown> = {}) => ({
  title: "Pazar kahvaltı turu",
  note: "Şile yolu, dönüşte Ağva",
  startsAt: inHours(48),
  meet: { name: "Kadıköy iskele", lat: 40.99, lng: 29.02 },
  destination: { name: "Şile" },
  distanceKm: 140,
  pace: "steady",
  vehicleKind: "motorcycle",
  ...over,
});

describe("/api/ride-events", () => {
  it("requires auth; the invite page does not", async () => {
    const app = buildTestApp();
    expect((await request(app).get("/api/ride-events")).status).toBe(401);
    expect((await request(app).get("/r/NOPE22")).status).toBe(404);
  });

  it("plan → invite link → RSVP → list → start live → cancel", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app);
    const buddy = await signUpAndSignIn(app);

    const created = await request(app).post("/api/ride-events").set("Cookie", owner.cookie).send(plan());
    expect(created.status).toBe(201);
    const ev = created.body;
    expect(ev.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(ev.isOwner).toBe(true);
    expect(ev.goingCount).toBe(1); // the organiser is on it
    expect(ev.myStatus).toBe("going");

    // The public preview carries Open Graph tags and no names/emails.
    const page = await request(app).get(`/r/${ev.code}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('property="og:title"');
    expect(page.text).toContain("Pazar kahvaltı turu");
    expect(page.text).not.toContain(owner.user.email);

    // A friend opens the link in the app.
    const seen = await request(app).get(`/api/ride-events/${ev.code.toLowerCase()}`).set("Cookie", buddy.cookie);
    expect(seen.status).toBe(200);
    expect(seen.body.isOwner).toBe(false);
    expect(seen.body.myStatus).toBeNull();
    // No email addresses leak to other riders.
    expect(JSON.stringify(seen.body)).not.toContain("@test.com");

    const rsvp = await request(app)
      .put(`/api/ride-events/${ev.code}/rsvp`)
      .set("Cookie", buddy.cookie)
      .send({ status: "maybe" });
    expect(rsvp.status).toBe(200);
    expect(rsvp.body.maybeCount).toBe(1);

    const list = await request(app).get("/api/ride-events").set("Cookie", buddy.cookie);
    expect(list.body.upcoming.map((e: { id: string }) => e.id)).toEqual([ev.id]);

    // Only the organiser can edit, start or cancel.
    expect((await request(app).post(`/api/ride-events/${ev.id}/live`).set("Cookie", buddy.cookie)).status).toBe(404);
    const live = await request(app).post(`/api/ride-events/${ev.id}/live`).set("Cookie", owner.cookie);
    expect(live.body.liveCode).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    // Starting twice keeps the same room.
    const again = await request(app).post(`/api/ride-events/${ev.id}/live`).set("Cookie", owner.cookie);
    expect(again.body.liveCode).toBe(live.body.liveCode);
    // Friends see the way in and can join the live room with it.
    const join = await request(app)
      .post("/api/ride-groups/join")
      .set("Cookie", buddy.cookie)
      .send({ code: live.body.liveCode });
    expect(join.status).toBe(200);

    const cancelled = await request(app).post(`/api/ride-events/${ev.id}/cancel`).set("Cookie", owner.cookie);
    expect(cancelled.body.cancelled).toBe(true);
    const after = await request(app).get("/api/ride-events").set("Cookie", buddy.cookie);
    expect(after.body.upcoming).toHaveLength(0);
    expect(after.body.past[0].cancelled).toBe(true);
    expect(
      (await request(app).put(`/api/ride-events/${ev.code}/rsvp`).set("Cookie", buddy.cookie).send({ status: "going" }))
        .status,
    ).toBe(409);
  });

  it("validates start time, capacity and bike ownership", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    const c = await signUpAndSignIn(app);
    const past = await request(app).post("/api/ride-events").set("Cookie", a.cookie).send(plan({ startsAt: inHours(-2) }));
    expect(past.status).toBe(400);
    expect(past.body.error).toBe("start_in_past");

    const ev = (await request(app).post("/api/ride-events").set("Cookie", a.cookie).send(plan({ maxRiders: 2 }))).body;
    expect((await request(app).put(`/api/ride-events/${ev.code}/rsvp`).set("Cookie", b.cookie).send({ status: "going" })).status).toBe(200);
    const full = await request(app).put(`/api/ride-events/${ev.code}/rsvp`).set("Cookie", c.cookie).send({ status: "going" });
    expect(full.status).toBe(409);
    expect(full.body.error).toBe("ride_full");
    // "maybe" never counts against the cap.
    expect((await request(app).put(`/api/ride-events/${ev.code}/rsvp`).set("Cookie", c.cookie).send({ status: "maybe" })).status).toBe(200);

    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Kara", make: "Yamaha", model: "MT-09", vehicleType: "motorcycle" });
    const foreign = await request(app)
      .put(`/api/ride-events/${ev.code}/rsvp`)
      .set("Cookie", c.cookie)
      .send({ status: "maybe", bikeId: bike.body.id });
    expect(foreign.status).toBe(400);
  });

  it("riders can leave and report; the organiser can remove them", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    const ev = (await request(app).post("/api/ride-events").set("Cookie", a.cookie).send(plan())).body;
    await request(app).put(`/api/ride-events/${ev.code}/rsvp`).set("Cookie", b.cookie).send({ status: "going" });
    const removed = await request(app).delete(`/api/ride-events/${ev.id}/riders/${b.user.id}`).set("Cookie", a.cookie);
    expect(removed.body.goingCount).toBe(1);
    expect((await request(app).delete(`/api/ride-events/${ev.code}/rsvp`).set("Cookie", a.cookie)).status).toBe(409);

    await request(app).put(`/api/ride-events/${ev.code}/rsvp`).set("Cookie", b.cookie).send({ status: "going" });
    const rep = await request(app).post(`/api/ride-events/${ev.code}/report`).set("Cookie", b.cookie).send({ reason: "spam" });
    expect(rep.body.ok).toBe(true);
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM ride_event_report WHERE event_id = ?").get(ev.id) as { n: number };
    expect(n.n).toBe(1);
    const list = await request(app).get("/api/ride-events").set("Cookie", b.cookie);
    expect(list.body.upcoming).toHaveLength(0);
  });

  it("reminds once, an hour before", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const ev = (await request(app).post("/api/ride-events").set("Cookie", a.cookie).send(plan({ startsAt: inHours(0.9) }))).body;
    const first = remindUpcomingRides();
    expect(first).toBeGreaterThanOrEqual(1);
    const row = getDb().prepare("SELECT reminded_at FROM ride_event WHERE id = ?").get(ev.id) as { reminded_at: string | null };
    expect(row.reminded_at).not.toBeNull();
    const again = getDb().prepare("SELECT COUNT(*) AS n FROM ride_event WHERE id = ? AND reminded_at IS NULL").get(ev.id) as { n: number };
    expect(again.n).toBe(0);
  });
});
