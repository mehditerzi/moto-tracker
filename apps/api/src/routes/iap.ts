import { Router } from "express";
import { z } from "zod";
import { NotificationTypeV2, type JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { tierForProductId, type EntitlementStatus } from "@mototracker/shared";
import { iapEnabled, verifyTransaction, verifyNotification } from "../lib/appstore.js";
import {
  applyTransaction,
  findUserByOriginalTransaction,
  findUserByAccountToken,
  getOrCreateAccountToken,
  getEntitlementSummary,
  type VerifiedTransaction,
} from "../lib/entitlement.js";

function normalize(
  t: JWSTransactionDecodedPayload,
  receivedVia: "verify" | "notification",
): VerifiedTransaction {
  return {
    transactionId: t.transactionId!,
    originalTransactionId: t.originalTransactionId!,
    productId: t.productId!,
    purchaseDateMs: t.purchaseDate ?? null,
    expiresDateMs: t.expiresDate ?? null,
    environment: t.environment ?? null,
    appAccountToken: t.appAccountToken ?? null,
    receivedVia,
    raw: t,
  };
}

// ─── client-side verification ─────────────────────────────────────────────────
// The native app sends the StoreKit 2 JWS for every current entitlement after a
// purchase or a "restore". We verify each, then grant the best still-valid tier.

export const iapRouter: Router = Router();
iapRouter.use(requireUser);

// The client fetches this UUID before a purchase and passes it to StoreKit as
// `appAccountToken`, so Apple's later notifications can be tied back to the user.
iapRouter.get(
  "/account-token",
  asyncHandler(async (req, res) => {
    res.json({ token: getOrCreateAccountToken(req.user!.id) });
  }),
);

const verifySchema = z.object({
  // jwsRepresentation strings from Transaction.currentEntitlements / the purchase.
  transactions: z.array(z.string().min(1)).min(1).max(20),
});

iapRouter.post(
  "/verify",
  asyncHandler(async (req, res) => {
    if (!iapEnabled()) {
      res.status(503).json({ error: "iap_unavailable" });
      return;
    }
    const { transactions } = verifySchema.parse(req.body);
    const userId = req.user!.id;
    const db = getDb();

    let applied = 0;
    let sigFailures = 0;
    let unknownProducts = 0;
    for (const jws of transactions) {
      let tx: VerifiedTransaction;
      try {
        tx = normalize(await verifyTransaction(jws), "verify");
      } catch (e) {
        // Common cause during development: StoreKit-configuration purchases in
        // the simulator are signed by Xcode's LOCAL test cert, not Apple —
        // they can never pass this check. Sandbox purchases on a device do.
        sigFailures++;
        console.warn(`[iap] verify: signature check failed for user ${userId}:`, (e as Error).message);
        continue;
      }
      // Only our known subscription products grant vehicles.
      if (!tierForProductId(tx.productId)) {
        unknownProducts++;
        console.warn(`[iap] verify: unknown product ${tx.productId} for user ${userId}`);
        continue;
      }
      const active = tx.expiresDateMs !== null && tx.expiresDateMs > Date.now();
      applyTransaction(userId, tx, active ? "active" : "expired", db);
      applied++;
    }

    if (applied === 0) {
      // Name the dominant failure so the client can explain it instead of
      // shrugging — a silent failure here reads as "the button does nothing".
      const error =
        sigFailures > 0 ? "verification_failed" : unknownProducts > 0 ? "unknown_product" : "no_valid_transaction";
      res.status(400).json({ error });
      return;
    }
    res.json(getEntitlementSummary(userId, db));
  }),
);

// ─── App Store Server Notifications V2 ──────────────────────────────────────────
// Apple → us, for renewals/cancellations/refunds/expiry. NOT auth-protected
// (Apple can't send our session); the JWS signature IS the authentication.

export const iapWebhookRouter: Router = Router();

const notificationSchema = z.object({ signedPayload: z.string().min(1) });

/** Map a notification type to the entitlement status it implies. */
function statusForNotification(type: string, expiresMs: number | null): Exclude<EntitlementStatus, "free"> {
  switch (type) {
    case NotificationTypeV2.EXPIRED:
    case NotificationTypeV2.GRACE_PERIOD_EXPIRED:
    case NotificationTypeV2.REFUND:
    case NotificationTypeV2.REVOKE:
      return "expired";
    // Billing retry with a grace period — access continues for now.
    case NotificationTypeV2.DID_FAIL_TO_RENEW:
      return "grace";
    default:
      // SUBSCRIBED, DID_RENEW, OFFER_REDEEMED, DID_CHANGE_RENEWAL_*, etc.
      return expiresMs !== null && expiresMs > Date.now() ? "active" : "expired";
  }
}

iapWebhookRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    if (!iapEnabled()) {
      res.status(503).json({ error: "iap_unavailable" });
      return;
    }
    const { signedPayload } = notificationSchema.parse(req.body);

    let notification;
    try {
      notification = await verifyNotification(signedPayload);
    } catch {
      res.status(400).json({ error: "invalid_signature" });
      return;
    }

    // A TEST notification (from App Store Connect) carries no transaction.
    const signedTx = notification.data?.signedTransactionInfo;
    if (!signedTx) {
      res.status(200).json({ ok: true });
      return;
    }

    let tx: VerifiedTransaction;
    try {
      tx = normalize(await verifyTransaction(signedTx), "notification");
    } catch {
      res.status(400).json({ error: "invalid_signature" });
      return;
    }

    if (tierForProductId(tx.productId)) {
      // Prefer the originalTransactionId mapping (set once the client verified);
      // fall back to the appAccountToken we planted at purchase time.
      const userId =
        findUserByOriginalTransaction(tx.originalTransactionId) ??
        (tx.appAccountToken ? findUserByAccountToken(tx.appAccountToken) : null);
      const status = statusForNotification(notification.notificationType!, tx.expiresDateMs);
      if (userId) {
        applyTransaction(userId, tx, status, getDb());
      } else {
        // We can't map this subscription to a user yet (e.g. it arrived before
        // the client verified). Log it so a later /verify can reconcile.
        getDb()
          .prepare(
            `INSERT OR IGNORE INTO iap_transaction
               (transaction_id, user_id, original_transaction_id, product_id, purchase_date, expires_date, environment, received_via, raw_payload)
             VALUES (?, NULL, ?, ?, ?, ?, ?, 'notification', ?)`,
          )
          .run(
            tx.transactionId,
            tx.originalTransactionId,
            tx.productId,
            tx.purchaseDateMs !== null ? new Date(tx.purchaseDateMs).toISOString() : null,
            tx.expiresDateMs !== null ? new Date(tx.expiresDateMs).toISOString() : null,
            tx.environment,
            JSON.stringify(tx.raw),
          );
      }
    }

    // Always 200 on a well-formed, verified notification so Apple stops retrying.
    res.status(200).json({ ok: true });
  }),
);
