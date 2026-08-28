import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { getDb } from "../src/db/index.js";
import { config } from "../src/config.js";

const count = (sql: string, ...args: unknown[]) =>
  (getDb().prepare(sql).get(...args) as { c: number }).c;

/**
 * Turn a test account into a passwordless one: drop the `credential` row and
 * leave a social provider row behind. This is exactly the shape better-auth
 * produces for magic-link / Google / Sign in with Apple users, for whom
 * `signInEmail` can only ever throw "Credential account not found".
 */
function makePasswordless(userId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM account WHERE userId = ? AND providerId = 'credential'").run(userId);
  db.prepare(
    "INSERT INTO account (id, userId, accountId, providerId) VALUES (?, ?, ?, 'google')",
  ).run(`acc_${userId}`, userId, `google_${userId}`);
}

describe("DELETE /api/me (account deletion)", () => {
  it("deletes the account and all of its data with the correct password", async () => {
    const app = buildTestApp();
    const me = await signUpAndSignIn(app, "delete-me@test.com");
    const other = await signUpAndSignIn(app, "keep-me@test.com");

    // Seed data for the account being deleted.
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", me.cookie)
      .send({ nickname: "Doomed" });
    const bikeId = bike.body.id;
    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", me.cookie)
      .send({ type: "sigorta", expiresOn: "2026-12-01" });
    await request(app)
      .post(`/api/bikes/${bikeId}/maintenance-items`)
      .set("Cookie", me.cookie)
      .send({ kind: "battery" });
    await request(app).get("/api/me").set("Cookie", me.cookie); // materialises profile row

    // And a leftover uploaded file on disk.
    const uploadDir = path.join(config.UPLOADS_DIR, me.user.id);
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, "doc.jpg"), "binary");

    // Seed data for the other account that must survive.
    await request(app)
      .post("/api/bikes")
      .set("Cookie", other.cookie)
      .send({ nickname: "Survivor" });

    const res = await request(app)
      .delete("/api/me")
      .set("Cookie", me.cookie)
      .send({ password: "supersecret123" });
    expect(res.status).toBe(204);

    // The user and every owned row are gone (FK cascade).
    expect(getDb().prepare("SELECT 1 FROM user WHERE id = ?").get(me.user.id)).toBeUndefined();
    expect(count("SELECT count(*) c FROM bike WHERE user_id = ?", me.user.id)).toBe(0);
    expect(count("SELECT count(*) c FROM dated_item WHERE user_id = ?", me.user.id)).toBe(0);
    expect(count("SELECT count(*) c FROM maintenance_item WHERE user_id = ?", me.user.id)).toBe(0);
    expect(count("SELECT count(*) c FROM profile WHERE user_id = ?", me.user.id)).toBe(0);
    expect(count("SELECT count(*) c FROM session WHERE userId = ?", me.user.id)).toBe(0);

    // The uploaded files are removed.
    expect(fs.existsSync(uploadDir)).toBe(false);

    // The other account is untouched.
    expect(getDb().prepare("SELECT 1 FROM user WHERE id = ?").get(other.user.id)).toBeDefined();
    expect(count("SELECT count(*) c FROM bike WHERE user_id = ?", other.user.id)).toBe(1);
  });

  it("rejects deletion with a wrong password and keeps all data", async () => {
    const app = buildTestApp();
    const me = await signUpAndSignIn(app, "safe@test.com");
    await request(app).post("/api/bikes").set("Cookie", me.cookie).send({ nickname: "Keep" });

    const res = await request(app)
      .delete("/api/me")
      .set("Cookie", me.cookie)
      .send({ password: "not-the-password" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_password");

    expect(getDb().prepare("SELECT 1 FROM user WHERE id = ?").get(me.user.id)).toBeDefined();
    expect(count("SELECT count(*) c FROM bike WHERE user_id = ?", me.user.id)).toBe(1);
  });

  it("requires authentication", async () => {
    const app = buildTestApp();
    const res = await request(app).delete("/api/me").send({ password: "supersecret123" });
    expect(res.status).toBe(401);
  });

  it("rejects a password user that sends the confirmation phrase instead", async () => {
    const app = buildTestApp();
    const me = await signUpAndSignIn(app, "no-bypass@test.com");

    const res = await request(app)
      .delete("/api/me")
      .set("Cookie", me.cookie)
      .send({ confirm: "DELETE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("password_required");

    expect(getDb().prepare("SELECT 1 FROM user WHERE id = ?").get(me.user.id)).toBeDefined();
  });

  describe("passwordless accounts (magic link / Google / Apple)", () => {
    it("reports hasPassword on GET /api/me for both account shapes", async () => {
      const app = buildTestApp();
      const withPw = await signUpAndSignIn(app, "haspw@test.com");
      const withoutPw = await signUpAndSignIn(app, "nopw@test.com");
      makePasswordless(withoutPw.user.id);

      const a = await request(app).get("/api/me").set("Cookie", withPw.cookie);
      expect(a.body.user.hasPassword).toBe(true);
      const b = await request(app).get("/api/me").set("Cookie", withoutPw.cookie);
      expect(b.body.user.hasPassword).toBe(false);
    });

    it("deletes the account with the typed confirmation phrase", async () => {
      const app = buildTestApp();
      const me = await signUpAndSignIn(app, "social-delete@test.com");
      makePasswordless(me.user.id);
      await request(app).post("/api/bikes").set("Cookie", me.cookie).send({ nickname: "Doomed" });

      const res = await request(app)
        .delete("/api/me")
        .set("Cookie", me.cookie)
        .send({ confirm: "DELETE" });
      expect(res.status).toBe(204);

      expect(getDb().prepare("SELECT 1 FROM user WHERE id = ?").get(me.user.id)).toBeUndefined();
      expect(count("SELECT count(*) c FROM bike WHERE user_id = ?", me.user.id)).toBe(0);
      expect(count("SELECT count(*) c FROM account WHERE userId = ?", me.user.id)).toBe(0);
    });

    it("rejects a wrong or missing confirmation phrase", async () => {
      const app = buildTestApp();
      const me = await signUpAndSignIn(app, "social-safe@test.com");
      makePasswordless(me.user.id);

      for (const body of [{ confirm: "delete" }, { confirm: "" }, {}]) {
        const res = await request(app).delete("/api/me").set("Cookie", me.cookie).send(body);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("confirmation_required");
      }

      // A password is meaningless here — there is no credential row to check it
      // against, so it must not be accepted as a substitute gate.
      const pw = await request(app)
        .delete("/api/me")
        .set("Cookie", me.cookie)
        .send({ password: "supersecret123" });
      expect(pw.status).toBe(400);
      expect(pw.body.error).toBe("confirmation_required");

      expect(getDb().prepare("SELECT 1 FROM user WHERE id = ?").get(me.user.id)).toBeDefined();
    });
  });
});
