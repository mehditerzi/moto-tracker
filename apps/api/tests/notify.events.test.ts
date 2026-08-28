import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn, uniqueTestEmail, type AuthedClient } from "./helpers/authedRequest.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import { addMember, createOrg } from "./helpers/org.js";
import { getDb } from "../src/db/index.js";
import { notificationsIdle } from "../src/notify/events.js";
import { __resetSendForTests, __setSendForTests } from "../src/notify/webPushClient.js";
import { __resetMailerForTests, __setMailerForTests, type Mail } from "../src/auth/email.js";

/**
 * EVENT-DRIVEN NOTIFICATIONS.
 *
 * The daily reminder path is tested in notify.dispatcher.test.ts. This file is
 * about the other half: sends caused by a person rather than by the calendar,
 * and the two things that make them dangerous rather than merely useful.
 *
 * The first is DISCLOSURE. The sharing design's central promise is that a
 * duplicate check tells nobody who holds a vehicle. A notification travels the
 * other way down the same relationship and would be the natural place for that
 * promise to leak — onto a lock screen, into an email sent to an address that
 * may have been mistyped. Most of the assertions below are negative ones.
 *
 * The second is FAILURE. A push or an email is a network call to somebody
 * else's infrastructure, wired into routes that move a real vehicle between two
 * accounts. The tests at the end put the transport into every failure mode it
 * has and check that the action underneath is untouched.
 */

const VIN = "WVWZZZ1JZ3W386752";

/** What actually left the process during a test. */
interface Captured {
  pushes: { endpoint: string; title: string; body: string; url: string }[];
  mails: Mail[];
}

let captured: Captured;

beforeEach(() => {
  captured = { pushes: [], mails: [] };
  __setSendForTests(async (input) => {
    const p = input.payload as { title: string; body: string; url: string };
    captured.pushes.push({ endpoint: input.endpoint, title: p.title, body: p.body, url: p.url });
    return { ok: true as const };
  });
  __setMailerForTests(async (mail) => {
    captured.mails.push(mail);
  });
});

afterEach(() => {
  __resetSendForTests();
  __resetMailerForTests();
});

/** Give a user one push endpoint, named after them so assertions read clearly. */
function subscribe(userId: string, label: string): string {
  const endpoint = `https://push.test/${label}`;
  getDb()
    .prepare(
      "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, 'P', 'A')",
    )
    .run(`sub-${label}`, userId, endpoint);
  return endpoint;
}

function setLanguage(userId: string, language: "tr" | "en"): void {
  getDb()
    .prepare(
      `INSERT INTO profile (user_id, language) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET language = excluded.language`,
    )
    .run(userId, language);
}

function muteSharing(userId: string): void {
  getDb()
    .prepare(
      "INSERT INTO notification_category_preference (user_id, category, enabled) VALUES (?, 'sharing', 0)",
    )
    .run(userId);
}

interface Scene {
  app: Express;
  holder: AuthedClient;
  requester: AuthedClient;
  bystander: AuthedClient;
  bikeId: string;
  claimToken: string;
  holderEndpoint: string;
  requesterEndpoint: string;
  bystanderEndpoint: string;
}

/**
 * A holder with a vehicle, a requester who has just collided with it, and an
 * uninvolved third account that must never hear a word about any of it.
 */
async function duplicateScene(): Promise<Scene> {
  const app = buildTestApp();
  const holder = await signUpAndSignIn(app);
  const requester = await signUpAndSignIn(app);
  const bystander = await signUpAndSignIn(app);

  const bike = await request(app)
    .post("/api/bikes")
    .set("Cookie", holder.cookie)
    .send({ nickname: "Corolla", plate: "34ABC123", chassisNo: VIN });
  expect(bike.status).toBe(201);

  const dup = await request(app)
    .post("/api/bikes")
    .set("Cookie", requester.cookie)
    .send({ nickname: "Aldığım araba", chassisNo: VIN });
  expect(dup.status).toBe(409);

  return {
    app,
    holder,
    requester,
    bystander,
    bikeId: bike.body.id,
    claimToken: dup.body.claimToken,
    holderEndpoint: subscribe(holder.user.id, "holder"),
    requesterEndpoint: subscribe(requester.user.id, "requester"),
    bystanderEndpoint: subscribe(bystander.user.id, "bystander"),
  };
}

async function fileClaim(s: Scene, kind: "access" | "purchase", message?: string) {
  const res = await request(s.app)
    .post("/api/vehicle-shares/claims")
    .set("Cookie", s.requester.cookie)
    .send({ claimToken: s.claimToken, kind, ...(message ? { message } : {}) });
  expect(res.status).toBe(201);
  await notificationsIdle();
  return res.body as { id: string };
}

// ─── who is told ─────────────────────────────────────────────────────────────

describe("a claim reaches the people who can answer it", () => {
  it("tells the holder about an access request, and nobody else", async () => {
    const s = await duplicateScene();
    await fileClaim(s, "access");

    expect(captured.pushes).toHaveLength(1);
    expect(captured.pushes[0]!.endpoint).toBe(s.holderEndpoint);
    expect(captured.pushes[0]!.url).toBe("/bikes");
  });

  it("tells the holder about a purchase claim, with the deadline in the sentence", async () => {
    const s = await duplicateScene();
    await fileClaim(s, "purchase");

    expect(captured.pushes).toHaveLength(1);
    const [push] = captured.pushes;
    expect(push!.endpoint).toBe(s.holderEndpoint);
    // The 21-day window is the whole point of telling them at all.
    expect(push!.body).toMatch(/21 gün içinde/);
  });

  /**
   * `approversOfBike` is the app's one definition of "who may decide this". The
   * set of people NOTIFIED has to be that same set — a manager who can approve
   * a claim but never hears about it is a claim that expires unanswered.
   */
  it("fans out to every approver of an org vehicle and never to the requester", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app);
    const manager = await signUpAndSignIn(app);
    const driver = await signUpAndSignIn(app);
    const requester = await signUpAndSignIn(app);

    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", owner.cookie)
      .send({ nickname: "Van", plate: "34VAN01", chassisNo: VIN });
    const orgId = createOrg("Kervan Filo", "fleet");
    addMember(orgId, owner.user.id, "owner");
    addMember(orgId, manager.user.id, "manager");
    // A driver is NOT an approver: they hold the keys, not the decision.
    addMember(orgId, driver.user.id, "driver");
    getDb().prepare("UPDATE bike SET org_id = ? WHERE id = ?").run(orgId, bike.body.id);

    const ownerEp = subscribe(owner.user.id, "owner");
    const managerEp = subscribe(manager.user.id, "manager");
    subscribe(driver.user.id, "driver");
    subscribe(requester.user.id, "requester");

    const dup = await request(app)
      .post("/api/bikes")
      .set("Cookie", requester.cookie)
      .send({ nickname: "Benim", chassisNo: VIN });
    expect(dup.status).toBe(409);

    await request(app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", requester.cookie)
      .send({ claimToken: dup.body.claimToken, kind: "purchase" });
    await notificationsIdle();

    expect(captured.pushes.map((p) => p.endpoint).sort()).toEqual([managerEp, ownerEp].sort());
  });

  it("notifies the requester when a claim is approved, and only the requester", async () => {
    const s = await duplicateScene();
    const claim = await fileClaim(s, "access");
    captured.pushes.length = 0;

    const res = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.id}/approve`)
      .set("Cookie", s.holder.cookie)
      .send({ role: "guest" });
    expect(res.status).toBe(200);
    await notificationsIdle();

    expect(captured.pushes).toHaveLength(1);
    expect(captured.pushes[0]!.endpoint).toBe(s.requesterEndpoint);
    expect(captured.pushes[0]!.title).toMatch(/onaylandı/i);
  });

  it("notifies the requester when a claim is declined", async () => {
    const s = await duplicateScene();
    const claim = await fileClaim(s, "purchase");
    captured.pushes.length = 0;

    await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.id}/decline`)
      .set("Cookie", s.holder.cookie)
      .send({});
    await notificationsIdle();

    expect(captured.pushes).toHaveLength(1);
    expect(captured.pushes[0]!.endpoint).toBe(s.requesterEndpoint);
    expect(captured.pushes[0]!.title).toMatch(/reddedildi/i);
  });
});

// ─── what is said ────────────────────────────────────────────────────────────

describe("a notification discloses no more than the feature does", () => {
  /**
   * The holder is told about THEIR vehicle. The requester's name, address and
   * note stay on the decision screen inside the app — a push renders on a
   * locked phone in front of whoever is standing there.
   */
  it("never puts the requester's identity on the holder's lock screen", async () => {
    const s = await duplicateScene();
    await fileClaim(s, "purchase", "Aracı 12 Mayıs'ta aldım");

    const text = `${captured.pushes[0]!.title} ${captured.pushes[0]!.body}`;
    expect(text).toContain("Corolla"); // the holder's own vehicle: fine
    expect(text).not.toContain(s.requester.user.email);
    expect(text).not.toContain("Test User");
    expect(text).not.toContain("12 Mayıs");
  });

  /**
   * The mirror image, and the one that matters most: a refusal is exactly when
   * a leak would be most tempting to write and most harmful to ship.
   */
  it("tells the requester nothing about the vehicle or its holder, even on a decline", async () => {
    const s = await duplicateScene();
    const claim = await fileClaim(s, "purchase");
    captured.pushes.length = 0;

    await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.id}/decline`)
      .set("Cookie", s.holder.cookie)
      .send({});
    await notificationsIdle();

    const text = `${captured.pushes[0]!.title} ${captured.pushes[0]!.body}`;
    expect(text).not.toContain("Corolla");
    expect(text).not.toContain("34ABC123");
    expect(text).not.toContain(s.holder.user.email);
    // Only the identifier they typed themselves comes back.
    expect(text).toContain(VIN);
  });

  it("writes each recipient's own language", async () => {
    const s = await duplicateScene();
    setLanguage(s.holder.user.id, "en");
    await fileClaim(s, "purchase");
    expect(captured.pushes[0]!.body).toBe("Someone says they bought Corolla. Answer within 21 days.");
  });

  it("defaults to Turkish when the recipient has no profile row", async () => {
    const s = await duplicateScene();
    await fileClaim(s, "access");
    expect(captured.pushes[0]!.body).toBe("Corolla için birisi erişim istiyor.");
  });
});

// ─── preferences ─────────────────────────────────────────────────────────────

describe("the sharing category", () => {
  /**
   * The decision this feature turns on. Muting sharing notifications silences
   * the courteous half of them — and deliberately cannot silence a request
   * filed against a vehicle you hold, because that request starts a three-week
   * clock and a toggle must not be able to run it against somebody who was
   * never addressable.
   */
  it("never silences a claim filed against a vehicle you hold", async () => {
    const s = await duplicateScene();
    muteSharing(s.holder.user.id);
    await fileClaim(s, "purchase");

    expect(captured.pushes).toHaveLength(1);
    expect(captured.pushes[0]!.endpoint).toBe(s.holderEndpoint);
  });

  it("silences the answer to a request you sent, when you asked it to", async () => {
    const s = await duplicateScene();
    muteSharing(s.requester.user.id);
    const claim = await fileClaim(s, "access");
    captured.pushes.length = 0;

    const res = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.id}/approve`)
      .set("Cookie", s.holder.cookie)
      .send({ role: "guest" });
    // Muted, but the approval itself still happened.
    expect(res.status).toBe(200);
    await notificationsIdle();
    expect(captured.pushes).toHaveLength(0);
  });

  /**
   * An invitation is addressed to an ADDRESS, not to an account, and the common
   * case is somebody who has never used this app. There is usually no
   * preference to read, and reading one when it happens to exist would mean the
   * invite route behaved differently for a registered address — the enumeration
   * oracle it is built to avoid. So the switch does not reach invitations, and
   * the copy beside it says so.
   */
  it("still delivers an invitation to somebody who muted sharing", async () => {
    const { app, owner, groupId } = await makeGroup();
    const invitee = await signUpAndSignIn(app);
    muteSharing(invitee.user.id);

    await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: invitee.user.email, role: "guest" });
    await notificationsIdle();

    expect(captured.mails.map((m) => m.to)).toEqual([invitee.user.email.toLowerCase()]);
  });

  it("defaults to on for an account that has never touched the setting", async () => {
    const app = buildTestApp();
    const user = await signUpAndSignIn(app);
    const res = await request(app)
      .get("/api/notification-preferences/categories")
      .set("Cookie", user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ category: "sharing", enabled: true }]);
  });

  it("round-trips a change and leaves the expiry reminders alone", async () => {
    const app = buildTestApp();
    const user = await signUpAndSignIn(app);
    const off = await request(app)
      .put("/api/notification-preferences/categories/sharing")
      .set("Cookie", user.cookie)
      .send({ enabled: false });
    expect(off.body).toEqual({ category: "sharing", enabled: false });

    // The reminder list is a different vocabulary and must not have grown one.
    const prefs = await request(app)
      .get("/api/notification-preferences")
      .set("Cookie", user.cookie);
    expect(prefs.body.map((p: { itemType: string }) => p.itemType).sort()).toEqual([
      "kasko",
      "maintenance",
      "mtv",
      "muayene",
      "sigorta",
    ]);
  });

  it("refuses a category it does not have", async () => {
    const app = buildTestApp();
    const user = await signUpAndSignIn(app);
    const res = await request(app)
      .put("/api/notification-preferences/categories/marketing")
      .set("Cookie", user.cookie)
      .send({ enabled: true });
    expect(res.status).toBe(400);
  });
});

// ─── invitations by email ────────────────────────────────────────────────────

async function makeGroup(): Promise<{ app: Express; owner: AuthedClient; groupId: string }> {
  const app = buildTestApp();
  const owner = await signUpAndSignIn(app);
  grantEntitlement(owner.user.id);
  const group = await request(app)
    .post("/api/vehicle-shares/groups")
    .set("Cookie", owner.cookie)
    .send({ name: "Aile Garajı" });
  expect(group.status).toBe(201);
  return { app, owner, groupId: group.body.id as string };
}

describe("a garage invitation reaches somebody with no account", () => {
  it("emails the invited address", async () => {
    const { app, owner, groupId } = await makeGroup();
    const stranger = uniqueTestEmail("nobody");

    const res = await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: stranger, role: "guest" });
    expect(res.status).toBe(201);
    await notificationsIdle();

    expect(captured.mails).toHaveLength(1);
    expect(captured.mails[0]!.to).toBe(stranger.toLowerCase());
    // The link carries the token that came back to the inviter, so the mail is
    // the same invitation and not a second one.
    expect(captured.mails[0]!.text).toContain(encodeURIComponent(res.body.token));
  });

  /**
   * The address may simply have been mistyped, in which case this email is the
   * only thing a complete stranger ever sees of somebody's garage. It must
   * therefore describe nothing.
   */
  it("names neither the garage, its vehicles, nor the person inviting", async () => {
    const { app, owner, groupId } = await makeGroup();
    await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: uniqueTestEmail("nobody"), role: "member" });
    await notificationsIdle();

    const mail = captured.mails[0]!;
    const all = `${mail.subject} ${mail.text} ${mail.html}`;
    expect(all).not.toContain("Aile Garajı");
    expect(all).not.toContain(owner.user.email);
    expect(all).not.toContain("Test User");
    // Nor the role, which is a statement about what is in the garage.
    expect(all.toLowerCase()).not.toContain("member");
  });

  it("mails an existing account too, so the invite route betrays nothing by timing", async () => {
    const { app, owner, groupId } = await makeGroup();
    const existing = await signUpAndSignIn(app);

    await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: existing.user.email, role: "guest" });
    await notificationsIdle();

    expect(captured.mails.map((m) => m.to)).toEqual([existing.user.email.toLowerCase()]);
  });

  it("writes the invitation in the inviter's language when they have one", async () => {
    const { app, owner, groupId } = await makeGroup();
    setLanguage(owner.user.id, "en");
    await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: uniqueTestEmail("nobody"), role: "guest" });
    await notificationsIdle();
    expect(captured.mails[0]!.subject).toMatch(/you have been invited to a shared garage/i);
    expect(captured.mails[0]!.text).toMatch(/Somebody has invited you to a shared garage/i);
  });

  it("also mails on the one-tap single-vehicle share", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app);
    grantEntitlement(owner.user.id);
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", owner.cookie)
      .send({ nickname: "Corolla" });

    const res = await request(app)
      .post(`/api/vehicle-shares/vehicles/${bike.body.id}/share`)
      .set("Cookie", owner.cookie)
      .send({ email: uniqueTestEmail("nobody"), role: "guest" });
    expect(res.status).toBe(201);
    await notificationsIdle();
    expect(captured.mails).toHaveLength(1);
    // …and still without naming the vehicle, even though the group is named
    // after it.
    expect(captured.mails[0]!.text).not.toContain("Corolla");
  });
});

// ─── abuse controls ──────────────────────────────────────────────────────────

describe("invitation email cannot become a relay", () => {
  it("does not mail the same address about the same garage twice in a row", async () => {
    const { app, owner, groupId } = await makeGroup();
    const target = uniqueTestEmail("nobody");
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/vehicle-shares/groups/${groupId}/invites`)
        .set("Cookie", owner.cookie)
        .send({ email: target, role: "guest" });
    }
    await notificationsIdle();
    expect(captured.mails).toHaveLength(1);
  });

  it("lets the same address be invited again once the cooldown has passed", async () => {
    const { app, owner, groupId } = await makeGroup();
    const target = uniqueTestEmail("nobody");
    await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: target, role: "guest" });
    await notificationsIdle();

    getDb()
      .prepare("UPDATE notification_event SET sent_at = datetime('now', '-1 hour')")
      .run();

    await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: target, role: "guest" });
    await notificationsIdle();
    expect(captured.mails).toHaveLength(2);
  });

  /**
   * The durable ceiling. `shareInviteLimiter` is inert in test (and in-memory in
   * production, so it resets on every deploy); this is the one that actually
   * bounds how much mail one account can push out of our sending domain in a
   * day.
   */
  it("stops after the daily cap, however many groups the sender has", async () => {
    const { app, owner, groupId } = await makeGroup();
    // Pre-load the day with the cap, attributed to this sender.
    const insert = getDb().prepare(
      `INSERT INTO notification_event (id, recipient, user_id, actor_id, kind, subject_id, channel)
       VALUES (?, ?, NULL, ?, 'share_invite', ?, 'email')`,
    );
    for (let i = 0; i < 20; i++) {
      insert.run(`ev${i}`, `filler${i}@test.com`, owner.user.id, `org${i}`);
    }

    const res = await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: uniqueTestEmail("nobody"), role: "guest" });
    // The invitation is still ISSUED — the inviter can copy the link — but no
    // mail leaves.
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    await notificationsIdle();
    expect(captured.mails).toHaveLength(0);
  });
});

// ─── idempotency ─────────────────────────────────────────────────────────────

describe("a repeat cannot notify twice", () => {
  it("records one row per (recipient, event, channel) and sends once", async () => {
    const s = await duplicateScene();
    const claim = await fileClaim(s, "purchase");

    const rows = getDb()
      .prepare("SELECT recipient, kind, subject_id, channel FROM notification_event")
      .all() as { recipient: string; kind: string; subject_id: string; channel: string }[];
    expect(rows).toEqual([
      {
        recipient: s.holder.user.id,
        kind: "claim_purchase",
        subject_id: claim.id,
        channel: "push",
      },
    ]);
  });

  it("suppresses a replayed decision", async () => {
    const s = await duplicateScene();
    const claim = await fileClaim(s, "access");
    captured.pushes.length = 0;

    await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.id}/approve`)
      .set("Cookie", s.holder.cookie)
      .send({ role: "guest" });
    await notificationsIdle();
    expect(captured.pushes).toHaveLength(1);

    // Replay the whole route. It 404s (the claim is no longer decidable), and
    // even if it had not, the reservation would have stopped a second send.
    await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.id}/approve`)
      .set("Cookie", s.holder.cookie)
      .send({ role: "guest" });
    // …and directly, bypassing the route's own guard.
    const { notifyClaimDecided } = await import("../src/notify/events.js");
    notifyClaimDecided(claim.id, "approved");
    await notificationsIdle();

    expect(captured.pushes).toHaveLength(1);
  });
});

// ─── endpoints and failure ───────────────────────────────────────────────────

describe("transport failures", () => {
  it("purges an endpoint the push service reports as gone", async () => {
    const s = await duplicateScene();
    __setSendForTests(async () => ({ ok: false as const, gone: true, status: 410, message: "gone" }));

    await fileClaim(s, "access");

    const rows = getDb()
      .prepare("SELECT endpoint FROM push_subscription WHERE user_id = ?")
      .all(s.holder.user.id);
    expect(rows).toEqual([]);
  });

  /**
   * The one that matters. A handover moves a vehicle, its service history and
   * its identity between two accounts. It has to survive APNs being down.
   */
  it("completes a handover even when every push throws", async () => {
    const s = await duplicateScene();
    const claim = await fileClaim(s, "purchase");
    __setSendForTests(async () => {
      throw new Error("APNs is on fire");
    });

    const res = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.id}/approve`)
      .set("Cookie", s.holder.cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.handoverId).toBeTruthy();
    await notificationsIdle();

    const bike = getDb().prepare("SELECT user_id FROM bike WHERE id = ?").get(s.bikeId) as {
      user_id: string;
    };
    expect(bike.user_id).toBe(s.requester.user.id);
    const handovers = getDb().prepare("SELECT COUNT(*) AS n FROM vehicle_handover").get() as {
      n: number;
    };
    expect(handovers.n).toBe(1);
  });

  it("still issues the invitation when the mail provider is down", async () => {
    const { app, owner, groupId } = await makeGroup();
    __setMailerForTests(async () => {
      throw new Error("Resend 503");
    });

    const res = await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: uniqueTestEmail("nobody"), role: "guest" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    await notificationsIdle();

    // The invitation row exists and is usable via the copied link…
    const invites = getDb()
      .prepare("SELECT COUNT(*) AS n FROM org_invite WHERE org_id = ?")
      .get(groupId) as { n: number };
    expect(invites.n).toBe(1);
    // …and the reservation was handed back, so a retry is not locked out by a
    // send that never happened.
    const reserved = getDb()
      .prepare("SELECT COUNT(*) AS n FROM notification_event WHERE channel = 'email'")
      .get() as { n: number };
    expect(reserved.n).toBe(0);
  });

  it("does not record a send that reached nobody, so a later attempt can", async () => {
    const s = await duplicateScene();
    __setSendForTests(async () => ({
      ok: false as const,
      gone: false,
      status: 500,
      message: "boom",
    }));
    const claim = await fileClaim(s, "access");

    const rows = getDb()
      .prepare("SELECT COUNT(*) AS n FROM notification_event WHERE subject_id = ?")
      .get(claim.id) as { n: number };
    expect(rows.n).toBe(0);
  });

  it("sends nothing at all when the recipient has no registered device", async () => {
    const app = buildTestApp();
    const holder = await signUpAndSignIn(app);
    const requester = await signUpAndSignIn(app);
    await request(app)
      .post("/api/bikes")
      .set("Cookie", holder.cookie)
      .send({ nickname: "Corolla", chassisNo: VIN });
    const dup = await request(app)
      .post("/api/bikes")
      .set("Cookie", requester.cookie)
      .send({ nickname: "Benim", chassisNo: VIN });

    const res = await request(app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", requester.cookie)
      .send({ claimToken: dup.body.claimToken, kind: "access" });
    expect(res.status).toBe(201);
    await notificationsIdle();
    expect(captured.pushes).toHaveLength(0);
  });
});
