import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn, type AuthedClient } from "./helpers/authedRequest.js";
import { encodePolyline, decodePolyline, privacyTrimmedRoute } from "../src/lib/routePrivacy.js";
import { isObjectionable } from "../src/lib/contentFilter.js";
import { getDb } from "../src/db/index.js";

let n = 0;
async function rider(app: ReturnType<typeof buildTestApp>, name = "Ali Veli") {
  const c = await signUpAndSignIn(app);
  const handle = `rider${Date.now().toString(36)}${(n += 1)}`;
  const r = await request(app).put("/api/social/me").set("Cookie", c.cookie).send({ handle, displayName: name, acceptRules: true });
  expect(r.status).toBe(200);
  return { ...c, handle };
}

/** A straight 10 km line, eastward from Kadıköy. */
const LINE = encodePolyline(Array.from({ length: 101 }, (_, i) => [40.99, 29.02 + i * 0.00118] as [number, number]));

async function tripFor(app: ReturnType<typeof buildTestApp>, c: AuthedClient) {
  const bike = await request(app).post("/api/bikes").set("Cookie", c.cookie).send({ nickname: "Kara", make: "Yamaha", model: "MT-09", vehicleType: "motorcycle", color: "Siyah" });
  const now = Date.now();
  const trip = await request(app)
    .post("/api/trips")
    .set("Cookie", c.cookie)
    .send({ bikeId: bike.body.id, distanceKm: 42, startedAt: new Date(now - 3_600_000).toISOString(), endedAt: new Date(now).toISOString(), route: LINE });
  expect(trip.status).toBe(201);
  return trip.body.id as string;
}

describe("route privacy", () => {
  it("trims both ends and drops routes too short to keep", () => {
    const pts = decodePolyline(privacyTrimmedRoute(LINE)!);
    const orig = decodePolyline(LINE);
    expect(pts.length).toBeLessThan(orig.length);
    expect(pts[0]![1]).toBeGreaterThan(orig[0]![1] + 0.005); // ≥ ~500 m gone at the start
    expect(pts[pts.length - 1]![1]).toBeLessThan(orig[orig.length - 1]![1] - 0.005);
    const short = encodePolyline([[40.99, 29.02], [40.99, 29.025]]);
    expect(privacyTrimmedRoute(short)).toBeNull();
  });
});

describe("content filter", () => {
  it("catches profanity, leaves ordinary Turkish alone", () => {
    expect(isObjectionable("tam bir orospu çocuğu")).toBe(true);
    expect(isObjectionable("S1kt1r git")).toBe(true);
    expect(isObjectionable("Şikayetim yok, sıkışık trafik vardı ama çok güzel tur")).toBe(false);
    expect(isObjectionable("Pikap ile pick-up noktasına")).toBe(false);
  });
});

describe("/api/social", () => {
  it("needs a profile with accepted rules before posting or following", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const me = await request(app).get("/api/social/me").set("Cookie", a.cookie);
    expect(me.body.profile).toBeNull();
    expect(me.body.suggestedHandle).toMatch(/^[a-z][a-z0-9_.]{2,19}$/);
    const noRules = await request(app).put("/api/social/me").set("Cookie", a.cookie).send({ handle: "kartal", displayName: "Kartal" });
    expect(noRules.body.error).toBe("rules_not_accepted");
    const tripId = await tripFor(app, a);
    expect((await request(app).post("/api/social/posts").set("Cookie", a.cookie).send({ tripId })).body.error).toBe("profile_required");
  });

  it("handles are unique, case-insensitively; profanity is refused", async () => {
    const app = buildTestApp();
    const a = await rider(app);
    const b = await signUpAndSignIn(app);
    const taken = await request(app).put("/api/social/me").set("Cookie", b.cookie).send({ handle: a.handle.toUpperCase(), displayName: "X Y", acceptRules: true });
    expect([400, 409]).toContain(taken.status);
    const bad = await request(app).put("/api/social/me").set("Cookie", b.cookie).send({ handle: "temizisim", displayName: "orospu", acceptRules: true });
    expect(bad.body.error).toBe("objectionable");
  });

  it("follow → feed → kudos → comment → detail", async () => {
    const app = buildTestApp();
    const a = await rider(app, "Ayşe Yılmaz");
    const b = await rider(app, "Burak Demir");
    const tripId = await tripFor(app, a);

    const post = await request(app).post("/api/social/posts").set("Cookie", a.cookie).send({ tripId, caption: "Sahil yolu harikaydı", showRoute: true });
    expect(post.status).toBe(201);
    expect(post.body.route).not.toBe(LINE); // trimmed
    expect(post.body.vehicle.make).toBe("Yamaha");
    expect((await request(app).post("/api/social/posts").set("Cookie", a.cookie).send({ tripId })).status).toBe(409);

    // B does not follow A yet: A's post is not in B's feed.
    expect((await request(app).get("/api/social/feed").set("Cookie", b.cookie)).body.posts).toHaveLength(0);
    await request(app).post(`/api/social/profiles/${a.handle}/follow`).set("Cookie", b.cookie);
    const feed = await request(app).get("/api/social/feed").set("Cookie", b.cookie);
    expect(feed.body.posts.map((p: { id: string }) => p.id)).toEqual([post.body.id]);

    const prof = await request(app).get(`/api/social/profiles/${a.handle}`).set("Cookie", b.cookie);
    expect(prof.body.isFollowing).toBe(true);
    expect(prof.body.followers).toBe(1);
    expect(prof.body.garage[0].make).toBe("Yamaha");
    expect(JSON.stringify(prof.body)).not.toContain("@test.com");
    expect(JSON.stringify(prof.body)).not.toMatch(/plate/);

    const k = await request(app).post(`/api/social/posts/${post.body.id}/kudos`).set("Cookie", b.cookie);
    expect(k.body.kudos).toBe(1);
    expect(k.body.kudosByMe).toBe(true);
    const c = await request(app).post(`/api/social/posts/${post.body.id}/comments`).set("Cookie", b.cookie).send({ body: "Gaz!" });
    expect(c.status).toBe(201);
    const bad = await request(app).post(`/api/social/posts/${post.body.id}/comments`).set("Cookie", b.cookie).send({ body: "siktir" });
    expect(bad.body.error).toBe("objectionable");
    const detail = await request(app).get(`/api/social/posts/${post.body.id}`).set("Cookie", a.cookie);
    expect(detail.body.commentList).toHaveLength(1);
    expect(detail.body.kudosBy[0].handle).toBe(b.handle);

    // The post owner can delete a comment on their post.
    expect((await request(app).delete(`/api/social/comments/${c.body.id}`).set("Cookie", a.cookie)).status).toBe(204);
    // Only the author deletes a post.
    expect((await request(app).delete(`/api/social/posts/${post.body.id}`).set("Cookie", b.cookie)).status).toBe(404);
  });

  it("blocking hides everything both ways and severs follows", async () => {
    const app = buildTestApp();
    const a = await rider(app);
    const b = await rider(app);
    const tripId = await tripFor(app, a);
    const post = (await request(app).post("/api/social/posts").set("Cookie", a.cookie).send({ tripId })).body;
    await request(app).post(`/api/social/profiles/${a.handle}/follow`).set("Cookie", b.cookie);
    await request(app).post(`/api/social/blocks/${b.user.id}`).set("Cookie", a.cookie);
    expect((await request(app).get(`/api/social/profiles/${a.handle}`).set("Cookie", b.cookie)).status).toBe(404);
    expect((await request(app).get(`/api/social/posts/${post.id}`).set("Cookie", b.cookie)).status).toBe(404);
    expect((await request(app).get("/api/social/feed").set("Cookie", b.cookie)).body.posts).toHaveLength(0);
    expect((await request(app).post(`/api/social/profiles/${a.handle}/follow`).set("Cookie", b.cookie)).status).toBe(404);
    expect((await request(app).get(`/api/social/search?q=${a.handle}`).set("Cookie", b.cookie)).body).toHaveLength(0);
    const blocks = await request(app).get("/api/social/blocks").set("Cookie", a.cookie);
    expect(blocks.body[0].handle).toBe(b.handle);
    await request(app).delete(`/api/social/blocks/${b.user.id}`).set("Cookie", a.cookie);
    expect((await request(app).get(`/api/social/profiles/${a.handle}`).set("Cookie", b.cookie)).status).toBe(200);
  });

  it("reports hide the content for the reporter at once and for everyone at three", async () => {
    const app = buildTestApp();
    const a = await rider(app);
    const tripId = await tripFor(app, a);
    const post = (await request(app).post("/api/social/posts").set("Cookie", a.cookie).send({ tripId })).body;
    const reporters = [await rider(app), await rider(app), await rider(app)];
    for (const r of reporters) await request(app).post(`/api/social/profiles/${a.handle}/follow`).set("Cookie", r.cookie);
    await request(app).post("/api/social/reports").set("Cookie", reporters[0]!.cookie).send({ kind: "post", targetId: post.id, reason: "spam" });
    expect((await request(app).get("/api/social/feed").set("Cookie", reporters[0]!.cookie)).body.posts).toHaveLength(0);
    expect((await request(app).get("/api/social/feed").set("Cookie", reporters[1]!.cookie)).body.posts).toHaveLength(1);
    for (const r of reporters.slice(1)) await request(app).post("/api/social/reports").set("Cookie", r.cookie).send({ kind: "post", targetId: post.id });
    const hidden = getDb().prepare("SELECT hidden_at FROM post WHERE id = ?").get(post.id) as { hidden_at: string | null };
    expect(hidden.hidden_at).not.toBeNull();
  });

  it("search and suggestions find people; deleting the account removes the profile", async () => {
    const app = buildTestApp();
    const a = await rider(app, "Zeynep Kaya");
    const b = await rider(app);
    const s = await request(app).get(`/api/social/search?q=${a.handle.slice(0, 6)}`).set("Cookie", b.cookie);
    expect(s.body.some((p: { handle: string }) => p.handle === a.handle)).toBe(true);
    // Riding together makes a suggestion.
    const ev = await request(app).post("/api/ride-events").set("Cookie", a.cookie).send({
      title: "Tur", startsAt: new Date(Date.now() + 86_400_000).toISOString(), meet: { name: "Moda" },
    });
    await request(app).put(`/api/ride-events/${ev.body.code}/rsvp`).set("Cookie", b.cookie).send({ status: "going" });
    const sug = await request(app).get("/api/social/suggestions").set("Cookie", b.cookie);
    expect(sug.body[0]).toMatchObject({ handle: a.handle, reason: "rodeTogether" });

    expect((await request(app).delete("/api/me").set("Cookie", a.cookie).send({ password: "supersecret123" })).status).toBeLessThan(300);
    expect((await request(app).get(`/api/social/profiles/${a.handle}`).set("Cookie", b.cookie)).status).toBe(404);
  });
});
