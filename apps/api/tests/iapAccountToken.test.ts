import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { getDb } from "../src/db/index.js";
import {
  getOrCreateAccountToken,
  findUserByAccountToken,
  findUserByOriginalTransaction,
  applyTransaction,
  resolveEntitlement,
  type VerifiedTransaction,
} from "../src/lib/entitlement.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tx(userToken: string): VerifiedTransaction {
  return {
    transactionId: "tx_1",
    originalTransactionId: "otx_1",
    productId: "com.medhiterzi.mototracker.garage.3.yearly",
    purchaseDateMs: Date.now(),
    expiresDateMs: Date.now() + 365 * 24 * 3600 * 1000,
    environment: "Sandbox",
    appAccountToken: userToken,
    receivedVia: "verify",
    raw: {},
  };
}

describe("IAP account token + attribution", () => {
  it("GET /api/iap/account-token requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/iap/account-token");
    expect(res.status).toBe(401);
  });

  it("returns a stable UUID token per user", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const a = await request(app).get("/api/iap/account-token").set("Cookie", cookie);
    expect(a.status).toBe(200);
    expect(a.body.token).toMatch(UUID_RE);
    const b = await request(app).get("/api/iap/account-token").set("Cookie", cookie);
    expect(b.body.token).toBe(a.body.token); // idempotent
  });

  it("maps a subscription to its user by appAccountToken and by originalTransactionId", async () => {
    const app = buildTestApp();
    const { user } = await signUpAndSignIn(app);
    const db = getDb();

    const token = getOrCreateAccountToken(user.id, db);
    expect(findUserByAccountToken(token, db)).toBe(user.id);
    expect(findUserByAccountToken("nope", db)).toBeNull();

    // Applying a verified transaction grants the tier and records the mapping.
    applyTransaction(user.id, tx(token), "active", db);
    expect(resolveEntitlement(user.id, db).maxVehicles).toBe(3);
    expect(findUserByOriginalTransaction("otx_1", db)).toBe(user.id);
  });
});
