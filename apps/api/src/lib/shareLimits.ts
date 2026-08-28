import type { Request } from "express";
import crypto from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";

/**
 * Rate limits for the two endpoints that can be used to ASK QUESTIONS ABOUT
 * OTHER PEOPLE'S VEHICLES.
 *
 * Adding a vehicle is normally self-limiting — the entitlement ceiling means a
 * free user can do it once. But a duplicate is refused *before* anything is
 * created, so a rejected add costs nothing and can be repeated: type a chassis
 * number, read the 409, repeat. That turns `POST /api/bikes` into an oracle for
 * "is this VIN in the system", and with it a way to test whether a particular
 * car's owner uses this app.
 *
 * Three things blunt it, and the limiter is only the third:
 *
 *   1. The registry never matches on a PLATE, which is the only identifier a
 *      stranger can read off a bumper. A VIN has to be obtained — from the
 *      windscreen at close range, or from paperwork.
 *   2. The 409 says THAT the vehicle exists and nothing else: no id, no
 *      nickname, no holder, not even whether the holder is a person or a company.
 *      An enumerator learns one bit per attempt and cannot turn it into a name.
 *   3. This: a hard ceiling on how many attempts one account can make, so
 *      sweeping a VIN range is not a thing a script can do quietly.
 *
 * Keyed on the authenticated user rather than the IP, because these routes are
 * behind `requireUser` and mobile clients share IPs behind CGNAT — an IP key
 * would let one attacker exhaust a whole carrier's allowance.
 */
function userKey(req: Request): string {
  const id = req.user?.id;
  if (id) return `u:${crypto.createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
  return ipKeyGenerator(req.ip ?? "");
}

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  // A machine code, like every other refusal in this API — the client is
  // bilingual and translates it.
  message: { error: "too_many_requests" },
  // Inert in the test suite, exactly like the limiters in server.ts: an
  // adversarial test that files eleven claims on purpose must fail on the
  // permission model, not on a throttle.
  skip: () => config.NODE_ENV === "test",
} as const;

/**
 * Vehicle creation. Generous enough that a household adding five cars in one
 * sitting — or a fleet manager applying a twenty-document batch — never sees it,
 * tight enough that a VIN sweep is pointless.
 */
export const vehicleCreateLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 40,
});

/**
 * Filing a claim. Far tighter: each one lands in a stranger's inbox, so this is
 * an anti-harassment limit as much as an anti-enumeration one. The unique index
 * on (bike_id, requester_id) already stops repeat claims on the SAME vehicle;
 * this stops a spread across many.
 */
export const claimLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

/** Invitations. One knock per person is plenty; ten an hour is not a mailing list. */
export const shareInviteLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 20,
});
