import { describe, it, expect } from "vitest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { getDb } from "../src/db/index.js";
import { applyTransaction, effectiveExpiryMs, resolveEntitlement } from "../src/lib/entitlement.js";
import { productIdFor } from "@mototracker/shared";
import type { VerifiedTransaction } from "../src/lib/entitlement.js";

function tx(productId: string, purchaseMs: number, expiresMs: number | null): VerifiedTransaction {
  return {
    transactionId: `t_${Math.random().toString(36).slice(2)}`,
    originalTransactionId: `o_${Math.random().toString(36).slice(2)}`,
    productId,
    purchaseDateMs: purchaseMs,
    expiresDateMs: expiresMs,
    environment: "Sandbox",
    appAccountToken: null,
    receivedVia: "verify",
    raw: {},
  };
}

describe("non-renewing entitlement", () => {
  it("grants a 2-year non-renewing pack with a computed expiry", async () => {
    buildTestApp();
    const { user } = await signUpAndSignIn(buildTestApp());
    const db = getDb();
    const purchase = Date.now();
    const t = tx(productIdFor(5, "2yr"), purchase, null); // Apple sends no expiresDate

    // effective expiry is ~24 months out, not null/expired.
    const exp = effectiveExpiryMs(t);
    expect(exp).not.toBeNull();
    expect(exp! - purchase).toBeGreaterThan(700 * 24 * 3600 * 1000); // > ~700 days

    applyTransaction(user.id, t, "active", db);
    const ent = resolveEntitlement(user.id, db);
    expect(ent).toMatchObject({ maxVehicles: 5, status: "active" });
    expect(new Date(ent.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("a non-renewing purchase whose term already elapsed collapses to free", async () => {
    buildTestApp();
    const { user } = await signUpAndSignIn(buildTestApp());
    const db = getDb();
    // Purchased 3 years ago on a 2-year term → expired.
    const purchase = Date.now() - 3 * 365 * 24 * 3600 * 1000;
    const t = tx(productIdFor(5, "2yr"), purchase, null);
    applyTransaction(user.id, t, "active", db);
    const ent = resolveEntitlement(user.id, db);
    expect(ent).toMatchObject({ tier: "free", maxVehicles: 1, status: "expired" });
  });
});
