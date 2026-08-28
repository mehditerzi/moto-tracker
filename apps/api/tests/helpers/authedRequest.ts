import request from "supertest";
import crypto from "node:crypto";
import type { Express } from "express";

export interface AuthedClient {
  cookie: string;
  user: { id: string; email: string };
  agent: ReturnType<typeof request>;
}

/**
 * A test email that cannot collide, by construction.
 *
 * This used to be `u_${Date.now()}@test.com`. A timestamp is not an identity:
 * two sign-ups in the same millisecond — trivially two parallel workers, but
 * also two calls in a row inside one file — produced the same address and hit
 * `user.email UNIQUE`, which better-auth surfaces as a 200 with no Set-Cookie
 * rather than an error, so the test failed several frames later with something
 * unrelated.
 *
 * Three independent components now, so a clash needs all three to repeat:
 *   - the pid, unique across the worker processes alive at one time;
 *   - 8 random bytes, unique across pid reuse between runs;
 *   - a monotonic counter, unique within a process no matter how fast we go.
 */
const RUN_ID = `${process.pid.toString(36)}${crypto.randomBytes(8).toString("hex")}`;
let seq = 0;

export function uniqueTestEmail(prefix = "u"): string {
  return `${prefix}_${RUN_ID}_${(seq += 1).toString(36)}@test.com`;
}

export async function signUpAndSignIn(
  app: Express,
  email = uniqueTestEmail(),
  password = "supersecret123",
): Promise<AuthedClient> {
  const signup = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ email, password, name: "Test User" });
  const setCookies = signup.headers["set-cookie"];
  if (!setCookies) throw new Error("no Set-Cookie on sign-up; got status " + signup.status);
  const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .map((c: string) => c.split(";")[0])
    .join("; ");
  return {
    cookie,
    user: { id: signup.body.user.id, email: signup.body.user.email },
    agent: request(app),
  };
}
