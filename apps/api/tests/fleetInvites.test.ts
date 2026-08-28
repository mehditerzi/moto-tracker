import { describe, it, expect } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { Express } from "express";
import { fleetFixture, type FleetFixture } from "./helpers/fleetFixture.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { addMember } from "./helpers/org.js";
import { getDb } from "../src/db/index.js";

/**
 * The invitation token is the only bearer credential this API mints, so it is
 * tested like one: what a stranger gets, what a stale link gets, what the wrong
 * recipient gets, and what is left in the database afterwards.
 */

const invitesUrl = (orgId: string) => `/api/orgs/${orgId}/invites`;

async function invite(
  f: FleetFixture,
  email: string,
  role = "driver",
  cookie = f.owner.cookie,
): Promise<{ status: number; body: { token: string; invite: { id: string }; error?: string } }> {
  const res = await request(f.app).post(invitesUrl(f.orgId)).set("Cookie", cookie).send({ email, role });
  return { status: res.status, body: res.body };
}

function accept(app: Express, cookie: string, token: string) {
  return request(app).post("/api/org-invites/accept").set("Cookie", cookie).send({ token });
}

describe("issuing an invitation", () => {
  it("returns the token exactly once, and never stores it in the clear", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test", "staff");
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const stored = getDb()
      .prepare("SELECT token FROM org_invite WHERE id = ?")
      .get(res.body.invite.id) as { token: string };
    expect(stored.token).not.toBe(res.body.token);
    expect(stored.token).toBe(crypto.createHash("sha256").update(res.body.token).digest("hex"));

    // …and the list endpoint never carries it, hashed or otherwise.
    const list = await request(f.app).get(invitesUrl(f.orgId)).set("Cookie", f.owner.cookie);
    expect(JSON.stringify(list.body)).not.toContain(res.body.token);
    expect(list.body[0].token).toBeUndefined();
  });

  it("puts the token in the URL fragment, where no server log can see it", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test");
    expect(res.body).toHaveProperty("acceptUrl");
    const url = (res.body as unknown as { acceptUrl: string }).acceptUrl;
    expect(url).toContain("#token=");
    expect(url.split("#")[0]).not.toContain(res.body.token);
  });

  it("is refused to staff and drivers, and across tenants", async () => {
    const f = await fleetFixture();
    for (const c of [f.staff, f.driver]) {
      expect((await invite(f, "x@filo.test", "driver", c.cookie)).status).toBe(403);
    }
    for (const c of [f.rival, f.outsider]) {
      expect((await invite(f, "x@filo.test", "driver", c.cookie)).status).toBe(404);
    }
  });

  it("stops a manager from inviting an owner", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "sahip@filo.test", "owner", f.manager.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("owner_role_required");
  });

  it("refuses to invite someone who is already a member", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "STAFF@filo.test", "manager");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_member");
  });

  it("rejects a malformed address", async () => {
    const f = await fleetFixture();
    expect((await invite(f, "not-an-email")).status).toBe(400);
  });

  it("re-inviting replaces the outstanding link and kills the old token", async () => {
    const f = await fleetFixture();
    const first = await invite(f, "yeni@filo.test");
    const second = await invite(f, "yeni@filo.test");
    expect(second.status).toBe(201);
    expect(second.body.token).not.toBe(first.body.token);
    expect(
      (getDb().prepare("SELECT COUNT(*) c FROM org_invite WHERE org_id = ?").get(f.orgId) as {
        c: number;
      }).c,
    ).toBe(1);

    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");
    const dead = await accept(f.app, newcomer.cookie, first.body.token);
    expect(dead.status).toBe(404);
    expect(dead.body.error).toBe("invite_not_found");
    expect((await accept(f.app, newcomer.cookie, second.body.token)).status).toBe(200);
  });
});

describe("redeeming an invitation", () => {
  it("joins the invitee with the invited role", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test", "staff");
    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");

    const joined = await accept(f.app, newcomer.cookie, res.body.token);
    expect(joined.status).toBe(200);
    expect(joined.body).toEqual({
      orgId: f.orgId,
      name: "Kervan Filo",
      mode: "fleet",
      role: "staff",
    });
    const orgs = await request(f.app).get("/api/orgs").set("Cookie", newcomer.cookie);
    expect(orgs.body).toEqual([{ orgId: f.orgId, role: "staff", mode: "fleet", name: "Kervan Filo" }]);
  });

  it("works for an address that had no account when the invitation was sent", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "henuz-yok@filo.test", "driver");
    // The account is created only now, after the invitation exists.
    const later = await signUpAndSignIn(f.app, "henuz-yok@filo.test");
    expect((await accept(f.app, later.cookie, res.body.token)).status).toBe(200);
  });

  it("REFUSES a different signed-in user than the addressee", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "ali@filo.test", "manager");
    const veli = await signUpAndSignIn(f.app, "veli@filo.test");

    const stolen = await accept(f.app, veli.cookie, res.body.token);
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toBe("invite_email_mismatch");
    expect((await request(f.app).get("/api/orgs").set("Cookie", veli.cookie)).body).toEqual([]);
    // The invitation survives for its real recipient.
    const ali = await signUpAndSignIn(f.app, "ali@filo.test");
    expect((await accept(f.app, ali.cookie, res.body.token)).status).toBe(200);
  });

  it("cannot be replayed", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test");
    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");
    expect((await accept(f.app, newcomer.cookie, res.body.token)).status).toBe(200);

    const again = await accept(f.app, newcomer.cookie, res.body.token);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("invite_already_accepted");
  });

  it("refuses an expired token", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test");
    getDb()
      .prepare("UPDATE org_invite SET expires_at = datetime('now', '-1 day') WHERE id = ?")
      .run(res.body.invite.id);
    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");

    const late = await accept(f.app, newcomer.cookie, res.body.token);
    expect(late.status).toBe(410);
    expect(late.body.error).toBe("invite_expired");
    expect((await request(f.app).get("/api/orgs").set("Cookie", newcomer.cookie)).body).toEqual([]);
  });

  it("tells an unknown token nothing about which organizations exist", async () => {
    const f = await fleetFixture();
    for (const bad of ["", " ", "x", crypto.randomBytes(32).toString("base64url"), f.orgId]) {
      const res = await accept(f.app, f.outsider.cookie, bad);
      // Empty string fails validation; everything else is an honest "no such
      // invitation" with no hint that Kervan Filo is a real organization.
      expect([400, 404]).toContain(res.status);
      if (res.status === 404) expect(res.body.error).toBe("invite_not_found");
      expect(JSON.stringify(res.body)).not.toContain("Kervan");
    }
  });

  it("does not accept the stored digest in place of the token", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test");
    const digest = (
      getDb().prepare("SELECT token FROM org_invite WHERE id = ?").get(res.body.invite.id) as {
        token: string;
      }
    ).token;
    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");
    expect((await accept(f.app, newcomer.cookie, digest)).status).toBe(404);
  });

  it("requires a session", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test");
    const anon = await request(f.app)
      .post("/api/org-invites/accept")
      .send({ token: res.body.token });
    expect(anon.status).toBe(401);
  });

  it("refuses an existing active member and does not change their role", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test", "driver");
    // They join the org by another route before redeeming.
    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");
    getDb()
      .prepare("INSERT INTO org_member (org_id, user_id, role) VALUES (?, ?, 'manager')")
      .run(f.orgId, newcomer.user.id);

    const dupe = await accept(f.app, newcomer.cookie, res.body.token);
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toBe("already_member");
    expect((await request(f.app).get("/api/orgs").set("Cookie", newcomer.cookie)).body[0].role).toBe(
      "manager",
    );
  });

  it("lets a previously removed member back in on the invited role", async () => {
    const f = await fleetFixture();
    await request(f.app)
      .delete(`/api/orgs/${f.orgId}/members/${f.staff.user.id}`)
      .set("Cookie", f.owner.cookie);
    const res = await invite(f, "staff@filo.test", "manager");
    expect(res.status).toBe(201);

    const back = await accept(f.app, f.staff.cookie, res.body.token);
    expect(back.status).toBe(200);
    expect(back.body.role).toBe("manager");
  });
});

describe("previewing an invitation", () => {
  it("describes the invitation without joining anything", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "ali@filo.test", "staff");
    const veli = await signUpAndSignIn(f.app, "veli@filo.test");

    const preview = await request(f.app)
      .post("/api/org-invites/preview")
      .set("Cookie", veli.cookie)
      .send({ token: res.body.token });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      orgName: "Kervan Filo",
      mode: "fleet",
      role: "staff",
      email: "ali@filo.test",
      emailMatches: false,
    });
    // Previewing is not joining.
    expect((await request(f.app).get("/api/orgs").set("Cookie", veli.cookie)).body).toEqual([]);
  });

  it("gives a bad token the same 404 as accepting does", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .post("/api/org-invites/preview")
      .set("Cookie", f.outsider.cookie)
      .send({ token: crypto.randomBytes(32).toString("base64url") });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("invite_not_found");
  });
});

describe("revoking an invitation", () => {
  it("makes the link indistinguishable from one that never existed", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test");
    const del = await request(f.app)
      .delete(`${invitesUrl(f.orgId)}/${res.body.invite.id}`)
      .set("Cookie", f.owner.cookie);
    expect(del.status).toBe(204);

    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");
    const dead = await accept(f.app, newcomer.cookie, res.body.token);
    expect(dead.status).toBe(404);
    expect(dead.body.error).toBe("invite_not_found");
  });

  it("is refused to staff, and across tenants", async () => {
    const f = await fleetFixture();
    const res = await invite(f, "yeni@filo.test");
    expect(
      (await request(f.app)
        .delete(`${invitesUrl(f.orgId)}/${res.body.invite.id}`)
        .set("Cookie", f.staff.cookie)).status,
    ).toBe(403);
    expect(
      (await request(f.app)
        .delete(`${invitesUrl(f.rivalOrgId)}/${res.body.invite.id}`)
        .set("Cookie", f.rival.cookie)).status,
    ).toBe(404);
    // Still redeemable — neither refusal touched it.
    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");
    expect((await accept(f.app, newcomer.cookie, res.body.token)).status).toBe(200);
  });

  it("removing a member also kills their pending invitation", async () => {
    const f = await fleetFixture();
    // An invitation is outstanding when the same person is added by another
    // route (the operator CLI), so the link is still live while they are a
    // member. Removing them must not leave a way straight back in.
    const res = await invite(f, "yeni@filo.test", "manager");
    const newcomer = await signUpAndSignIn(f.app, "yeni@filo.test");
    addMember(f.orgId, newcomer.user.id, "staff");

    await request(f.app)
      .delete(`/api/orgs/${f.orgId}/members/${newcomer.user.id}`)
      .set("Cookie", f.owner.cookie);

    const sneak = await accept(f.app, newcomer.cookie, res.body.token);
    expect(sneak.status).toBe(404);
    expect(sneak.body.error).toBe("invite_not_found");
    expect((await request(f.app).get("/api/orgs").set("Cookie", newcomer.cookie)).body).toEqual([]);
  });
});
