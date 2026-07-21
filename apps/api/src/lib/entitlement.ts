import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/index.js";
import {
  FREE_MAX_VEHICLES,
  tierForProductId,
  computeExpiryMs,
  type EntitlementStatus,
  type EntitlementSummary,
} from "@mototracker/shared";

/**
 * Effective expiry (ms) for a verified transaction: Apple's expiresDate for
 * auto-renewable products, or purchase + term for non-renewing ones (Apple
 * sends no expiresDate on those). Null when the product is unknown.
 */
export function effectiveExpiryMs(tx: VerifiedTransaction): number | null {
  const tier = tierForProductId(tx.productId);
  if (!tier) return null;
  return computeExpiryMs(tier, tx.purchaseDateMs, tx.expiresDateMs);
}

/** A verified App Store transaction, normalized to what entitlement needs. */
export interface VerifiedTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  purchaseDateMs: number | null;
  expiresDateMs: number | null;
  environment: string | null;
  /** The UUID we set at purchase time; maps a subscription to our user. */
  appAccountToken: string | null;
  /** Provenance for the audit log. */
  receivedVia: "verify" | "notification";
  /** Full decoded payload, stored as JSON for debugging. */
  raw: unknown;
}

interface EntitlementRow {
  user_id: string;
  product_id: string | null;
  tier: string;
  max_vehicles: number;
  status: string;
  original_transaction_id: string | null;
  expires_at: string | null;
  environment: string | null;
  source: string;
  updated_at: string;
}

/** Count a user's active (non-archived) vehicles — the number that counts against the cap. */
export function countActiveBikes(userId: string, db: DB = getDb()): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM bike WHERE user_id = ? AND archived = 0")
    .get(userId) as { n: number };
  return row.n;
}

/**
 * Resolve the user's effective entitlement RIGHT NOW. A stored row whose
 * `expires_at` is in the past collapses back to the free tier — we never rely on
 * a background job to flip `status`, so a lapsed subscription is enforced the
 * instant it expires even if no webhook arrived yet.
 */
export function resolveEntitlement(
  userId: string,
  db: DB = getDb(),
): { tier: string; productId: string | null; status: EntitlementStatus; maxVehicles: number; expiresAt: string | null } {
  const row = db
    .prepare("SELECT * FROM entitlement WHERE user_id = ?")
    .get(userId) as EntitlementRow | undefined;

  if (!row || row.status === "free" || !row.product_id) {
    return { tier: "free", productId: null, status: "free", maxVehicles: FREE_MAX_VEHICLES, expiresAt: null };
  }

  // Past-due (or unknown) subscriptions grant nothing beyond the free tier.
  const expired = row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now();
  if (expired || row.status === "expired") {
    return {
      tier: "free",
      productId: null,
      status: "expired",
      maxVehicles: FREE_MAX_VEHICLES,
      expiresAt: row.expires_at,
    };
  }

  // Trust the catalog for the ceiling (defends against a stale max_vehicles if a
  // tier's mapping ever changes); fall back to the stored value for an unknown id.
  const tier = tierForProductId(row.product_id);
  const status: EntitlementStatus = row.status === "grace" ? "grace" : "active";
  return {
    tier: tier?.tier ?? row.tier,
    productId: row.product_id,
    status,
    maxVehicles: tier?.maxVehicles ?? row.max_vehicles,
    expiresAt: row.expires_at,
  };
}

/** Effective active-vehicle ceiling for a user. */
export function getMaxVehicles(userId: string, db: DB = getDb()): number {
  return resolveEntitlement(userId, db).maxVehicles;
}

/** True when the user can add one more active vehicle. */
export function canAddVehicle(userId: string, db: DB = getDb()): boolean {
  return countActiveBikes(userId, db) < getMaxVehicles(userId, db);
}

/**
 * The stable UUID we hand to StoreKit as `appAccountToken` at purchase time.
 * Apple echoes it back in every transaction/notification for the subscription,
 * letting us attribute server notifications to a user even before the client
 * verifies. Created lazily on first purchase intent; stable thereafter.
 */
export function getOrCreateAccountToken(userId: string, db: DB = getDb()): string {
  const existing = db
    .prepare("SELECT token FROM iap_account_token WHERE user_id = ?")
    .get(userId) as { token: string } | undefined;
  if (existing) return existing.token;
  const token = randomUUID();
  // ON CONFLICT guards a race where two purchase intents insert at once.
  db.prepare(
    "INSERT INTO iap_account_token (user_id, token) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING",
  ).run(userId, token);
  return (
    db.prepare("SELECT token FROM iap_account_token WHERE user_id = ?").get(userId) as {
      token: string;
    }
  ).token;
}

/** Reverse lookup: which user owns this appAccountToken (null if unknown). */
export function findUserByAccountToken(token: string, db: DB = getDb()): string | null {
  const row = db
    .prepare("SELECT user_id FROM iap_account_token WHERE token = ?")
    .get(token) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

/**
 * Find which app user a subscription belongs to. Renewals and server
 * notifications reference only Apple's originalTransactionId, so we resolve the
 * owner from the first transaction we verified client-side (which knew the user)
 * — via the current entitlement row, then the transaction log as a fallback.
 */
export function findUserByOriginalTransaction(
  originalTransactionId: string,
  db: DB = getDb(),
): string | null {
  const ent = db
    .prepare("SELECT user_id FROM entitlement WHERE original_transaction_id = ?")
    .get(originalTransactionId) as { user_id: string } | undefined;
  if (ent) return ent.user_id;
  const tx = db
    .prepare(
      "SELECT user_id FROM iap_transaction WHERE original_transaction_id = ? AND user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    )
    .get(originalTransactionId) as { user_id: string } | undefined;
  return tx?.user_id ?? null;
}

/**
 * Apply a verified transaction to a user's entitlement. Idempotent: the
 * transaction is logged once (INSERT OR IGNORE), and the entitlement row is set
 * to reflect this subscription's product + expiry + status. Older transactions
 * for the SAME subscription never regress a newer expiry, so out-of-order
 * webhook delivery can't shorten a valid period.
 *
 * `status` is decided by the caller (a renewal → 'active', an EXPIRED/REVOKE
 * notification → 'expired', a billing-retry grace period → 'grace').
 */
export function applyTransaction(
  userId: string,
  tx: VerifiedTransaction,
  status: Exclude<EntitlementStatus, "free">,
  db: DB = getDb(),
): void {
  const tier = tierForProductId(tx.productId);
  // Non-renewing IAPs carry no Apple expiresDate — derive it from the term.
  const expiresMs = tier ? computeExpiryMs(tier, tx.purchaseDateMs, tx.expiresDateMs) : tx.expiresDateMs;
  const expiresIso = expiresMs !== null ? new Date(expiresMs).toISOString() : null;

  const write = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO iap_transaction
         (transaction_id, user_id, original_transaction_id, product_id, purchase_date, expires_date, environment, received_via, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tx.transactionId,
      userId,
      tx.originalTransactionId,
      tx.productId,
      tx.purchaseDateMs !== null ? new Date(tx.purchaseDateMs).toISOString() : null,
      expiresIso,
      tx.environment,
      tx.receivedVia,
      JSON.stringify(tx.raw ?? null),
    );

    // Don't let a stale message shorten a still-valid period for this same sub.
    const current = db
      .prepare("SELECT expires_at, original_transaction_id FROM entitlement WHERE user_id = ?")
      .get(userId) as { expires_at: string | null; original_transaction_id: string | null } | undefined;
    if (
      status === "active" &&
      current &&
      current.original_transaction_id === tx.originalTransactionId &&
      current.expires_at &&
      expiresIso &&
      new Date(expiresIso).getTime() < new Date(current.expires_at).getTime()
    ) {
      return; // incoming expiry is older than what we already have — ignore.
    }

    db.prepare(
      `INSERT INTO entitlement
         (user_id, product_id, tier, max_vehicles, status, original_transaction_id, expires_at, environment, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'appstore', datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         product_id = excluded.product_id,
         tier = excluded.tier,
         max_vehicles = excluded.max_vehicles,
         status = excluded.status,
         original_transaction_id = excluded.original_transaction_id,
         expires_at = excluded.expires_at,
         environment = excluded.environment,
         updated_at = datetime('now')`,
    ).run(
      userId,
      tx.productId,
      tier?.tier ?? "unknown",
      tier?.maxVehicles ?? FREE_MAX_VEHICLES,
      status,
      tx.originalTransactionId,
      expiresIso,
      tx.environment,
    );
  });
  write();
}

/** Full summary for `GET /api/entitlement` and the paywall. */
export function getEntitlementSummary(userId: string, db: DB = getDb()): EntitlementSummary {
  const ent = resolveEntitlement(userId, db);
  const activeVehicles = countActiveBikes(userId, db);
  return {
    tier: ent.tier,
    productId: ent.productId,
    status: ent.status,
    maxVehicles: ent.maxVehicles,
    activeVehicles,
    canAddVehicle: activeVehicles < ent.maxVehicles,
    expiresAt: ent.expiresAt,
  };
}
