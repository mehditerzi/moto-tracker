/**
 * Native StoreKit 2 bridge (iOS only). Talks to the custom `StoreKit` Capacitor
 * plugin (Swift, see apps/web/ios). The plugin returns Apple's signed JWS
 * transaction strings; we forward them to the API, which verifies them against
 * Apple's root CAs and updates the entitlement. No third-party billing SDK.
 *
 * Every function no-ops / throws `iap_unavailable` on web, so callers must gate
 * on `isNativeIapAvailable()` first.
 *
 * ── Version skew is the normal case here ────────────────────────────────────
 * capacitor.config.ts points WKWebView at the live site, so THIS FILE updates
 * on every web deploy while the Swift plugin only changes when a new build
 * clears App Store review. Everything below therefore treats the newer plugin
 * fields (`outcome`, `missing`, `transactionIds`, `finishTransactions`, the
 * `transactionsUpdated` event) as OPTIONAL and degrades to the old behaviour
 * when they are absent.
 */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNative } from "./nativeAuth";
import { api } from "./api";
import { queryClient } from "./queryClient";
import { ENTITLEMENT_KEY } from "@/hooks/useEntitlement";
import { track } from "./telemetry";
import type { EntitlementSummary } from "@mototracker/shared";

export interface StoreKitProduct {
  id: string;
  displayName: string;
  /** Localized, currency-formatted price string from StoreKit (e.g. "₺100,00"). */
  displayPrice: string;
}

/** What the plugin reports back for a purchase attempt. */
export type PurchaseOutcome =
  | { status: "success"; entitlement: EntitlementSummary }
  /** The user dismissed the App Store sheet. Not an error. */
  | { status: "cancelled" }
  /**
   * Deferred: Ask to Buy, SCA / bank verification, or a payment method that
   * needs action. The money has NOT moved yet and the purchase may complete
   * minutes later — it will arrive on the `transactionsUpdated` listener.
   */
  | { status: "pending" }
  /**
   * An older native binary that cannot tell "cancelled" from "pending" apart.
   * Treated as cancelled by the UI, but tracked separately so the rollout of
   * the fixed binary is measurable.
   */
  | { status: "unknown" };

/** Result of resolving the catalogue against StoreKit. */
export interface ProductCatalog {
  products: StoreKitProduct[];
  /**
   * Requested product ids StoreKit did not return. Almost always an App Store
   * Connect problem (not approved / not cleared for sale / wrong id), which is
   * otherwise invisible: `Product.products(for:)` just omits them.
   * `null` when the native binary is too old to report it.
   */
  missing: string[] | null;
  /** false when parental controls / MDM forbid purchases on this device. */
  canMakePayments: boolean;
  /** Two-letter storefront country, for diagnosing region-gated products. */
  storefront: string | null;
}

interface NativePurchaseResult {
  outcome?: "success" | "cancelled" | "pending" | "unknown";
  transactions: string[];
  transactionIds?: string[];
  verified?: boolean;
}

interface NativeTransactionsEvent {
  transactions?: string[];
  transactionIds?: string[];
  productId?: string;
  verified?: boolean;
}

interface StoreKitPlugin {
  getProducts(options: { productIds: string[] }): Promise<{
    products: StoreKitProduct[];
    missing?: string[];
    canMakePayments?: boolean;
    storefront?: string;
  }>;
  /** Returns the signed JWS transaction(s) plus how the attempt ended. */
  purchase(options: {
    productId: string;
    /** UUID echoed back in Apple's notifications so they map to this user. */
    appAccountToken?: string;
  }): Promise<NativePurchaseResult>;
  /** Returns signed JWS for all of the user's current entitlements. */
  restore(): Promise<{ transactions: string[]; transactionIds?: string[] }>;
  /** Marks transactions delivered. Only call AFTER the server recorded them. */
  finishTransactions(options: { transactionIds: string[] }): Promise<{ finished: number }>;
  addListener(
    eventName: "transactionsUpdated",
    handler: (event: NativeTransactionsEvent) => void,
  ): Promise<PluginListenerHandle>;
}

let _plugin: StoreKitPlugin | null = null;
function plugin(): StoreKitPlugin {
  if (!_plugin) _plugin = registerPlugin<StoreKitPlugin>("StoreKit");
  return _plugin;
}

export function isNativeIapAvailable(): boolean {
  return isNative();
}

/** True when a Capacitor error means the native plugin isn't in this build. */
function isPluginMissing(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "UNIMPLEMENTED" || /not implemented/i.test(err?.message ?? "");
}

/**
 * The stable machine code carried by a rejected native call. The Swift plugin
 * rejects with a distinct `iap_*` code per StoreKit failure (network, product
 * unavailable, payment not allowed, …) so both the user-facing message and the
 * telemetry are actionable; anything unrecognised falls back.
 */
function nativeErrorCode(e: unknown, fallback: string): string {
  if (isPluginMissing(e)) return "iap_plugin_missing";
  const msg = (e as { message?: string })?.message ?? "";
  return /^iap_[a-z_]+$/.test(msg) ? msg : fallback;
}

// ─── product catalogue ────────────────────────────────────────────────────────
// Resolved products are cached for the session so opening the paywall a second
// time is instant and so a purchase never waits on a network round-trip.

const CATALOG_TTL_MS = 5 * 60_000;
let catalogCache: { at: number; value: ProductCatalog } | null = null;
let catalogInFlight: Promise<ProductCatalog> | null = null;

const EMPTY_CATALOG: ProductCatalog = {
  products: [],
  missing: null,
  canMakePayments: true,
  storefront: null,
};

async function loadCatalog(productIds: string[]): Promise<ProductCatalog> {
  const res = await plugin().getProducts({ productIds });
  return {
    products: res.products ?? [],
    // `undefined` = old binary that cannot report it; `[]` = nothing missing.
    missing: Array.isArray(res.missing) ? res.missing : null,
    canMakePayments: res.canMakePayments !== false,
    storefront: res.storefront || null,
  };
}

/**
 * Resolve the catalogue against StoreKit, with one retry. Throws a stable code
 * (`iap_products_failed`, `iap_network_error`, …) so the paywall can say what
 * went wrong instead of rendering an empty, unexplained sheet.
 */
export async function fetchProductCatalog(
  productIds: string[],
  opts: { force?: boolean } = {},
): Promise<ProductCatalog> {
  if (!isNative()) return EMPTY_CATALOG;
  if (!opts.force && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.value;
  }
  if (!opts.force && catalogInFlight) return catalogInFlight;

  catalogInFlight = (async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
      try {
        const value = await loadCatalog(productIds);
        catalogCache = { at: Date.now(), value };
        return value;
      } catch (e) {
        lastErr = e;
        if (isPluginMissing(e)) break;
      }
    }
    throw new Error(nativeErrorCode(lastErr, "iap_products_failed"));
  })();

  try {
    return await catalogInFlight;
  } finally {
    catalogInFlight = null;
  }
}

// ─── server verification ──────────────────────────────────────────────────────

/** Send verified JWS to the backend and return the updated entitlement. */
async function verifyOnServer(transactions: string[]): Promise<EntitlementSummary> {
  return api<EntitlementSummary>("/api/iap/verify", {
    method: "POST",
    json: { transactions },
  });
}

/**
 * Tell StoreKit the purchase was delivered. Deliberately AFTER the server call:
 * an unfinished transaction is redelivered on the next launch, so a failed
 * verification is recoverable instead of a customer paying for nothing. Old
 * binaries finish eagerly and reject this call — that is harmless.
 */
async function finishTransactions(transactionIds: string[]): Promise<void> {
  if (!transactionIds.length) return;
  try {
    await plugin().finishTransactions({ transactionIds });
  } catch {
    /* old binary (already finished) or nothing left to finish */
  }
}

async function verifyAndFinish(
  transactions: string[],
  transactionIds: string[] = [],
): Promise<EntitlementSummary> {
  const summary = await verifyOnServer(transactions);
  await finishTransactions(transactionIds);
  return summary;
}

function publishEntitlement(summary: EntitlementSummary): void {
  queryClient.setQueryData(ENTITLEMENT_KEY, summary);
  void queryClient.invalidateQueries({ queryKey: ["bikes"] });
}

// ─── out-of-band transactions (deferred approvals, renewals, other devices) ───

type EntitlementListener = (summary: EntitlementSummary) => void;
const grantListeners = new Set<EntitlementListener>();

/**
 * Observe entitlements granted OUTSIDE the current purchase call — an Ask to Buy
 * approved by a parent, a bank 3-D Secure confirmation, a renewal. The paywall
 * subscribes while it is open so a "waiting for approval" state can flip to
 * "you're all set" on its own.
 */
export function onEntitlementGranted(fn: EntitlementListener): () => void {
  grantListeners.add(fn);
  return () => grantListeners.delete(fn);
}

let listenerHandle: Promise<PluginListenerHandle> | null = null;

async function handleNativeTransactions(event: NativeTransactionsEvent): Promise<void> {
  const transactions = event.transactions ?? [];
  if (!transactions.length) return;
  if (event.verified === false) {
    // Locally unverifiable — the server would reject the signature too.
    track("iap_transaction_unverified", { productId: event.productId });
    return;
  }
  try {
    const summary = await verifyAndFinish(transactions, event.transactionIds ?? []);
    publishEntitlement(summary);
    track("iap_deferred_granted", { productId: event.productId });
    for (const fn of grantListeners) {
      try {
        fn(summary);
      } catch {
        /* a listener must never break the others */
      }
    }
  } catch (e) {
    // Left unfinished on purpose — StoreKit redelivers it next launch.
    track("iap_deferred_verify_failed", {
      productId: event.productId,
      code: (e as Error).message,
    });
  }
}

/**
 * Subscribe to `Transaction.updates`. Idempotent, safe to call on every launch,
 * and a no-op on web or on a native binary without the event (the bridge
 * accepts the listener and simply never fires it).
 */
export function installTransactionListener(): void {
  if (!isNative() || listenerHandle) return;
  try {
    listenerHandle = plugin().addListener("transactionsUpdated", (event) => {
      void handleNativeTransactions(event);
    });
    void listenerHandle.catch(() => {
      listenerHandle = null;
    });
  } catch {
    listenerHandle = null;
  }
}

// ─── purchase ─────────────────────────────────────────────────────────────────

/** Buy a pack, then have the server verify and grant it. */
export async function purchaseTier(productId: string): Promise<PurchaseOutcome> {
  if (!isNative()) throw new Error("iap_unavailable");
  // Make sure a deferred completion is never missed while we're mid-flow.
  installTransactionListener();
  // Plant our user's appAccountToken so Apple's server notifications (renewals,
  // cancellations) map back to this account even before/without a client verify.
  // Non-fatal if it fails — the purchase still verifies via originalTransactionId.
  let appAccountToken: string | undefined;
  try {
    appAccountToken = (await api<{ token: string }>("/api/iap/account-token")).token;
  } catch {
    /* ignore — token is a best-effort mapping aid */
  }

  let result: NativePurchaseResult;
  try {
    result = await plugin().purchase({ productId, appAccountToken });
  } catch (e) {
    // An old build without the StoreKit plugin must say so, not fail generically.
    throw new Error(nativeErrorCode(e, "iap_purchase_failed"));
  }

  const transactions = result.transactions ?? [];
  const outcome = result.outcome;

  if (outcome === "pending") return { status: "pending" };
  if (outcome === "cancelled") return { status: "cancelled" };

  if (!transactions.length) {
    // Old binary: `.userCancelled` and `.pending` both arrived as an empty
    // array, so the honest answer is "we don't know".
    return { status: outcome === undefined ? "unknown" : "cancelled" };
  }

  const entitlement = await verifyAndFinish(transactions, result.transactionIds ?? []);
  publishEntitlement(entitlement);
  return { status: "success", entitlement };
}

/** Restore previous purchases (e.g. after reinstall / new device). */
export async function restorePurchases(): Promise<EntitlementSummary> {
  if (!isNative()) throw new Error("iap_unavailable");
  let res: { transactions: string[]; transactionIds?: string[] };
  try {
    res = await plugin().restore();
  } catch (e) {
    throw new Error(nativeErrorCode(e, "iap_restore_failed"));
  }
  if (!res.transactions.length) throw new Error("no_purchases");
  const summary = await verifyAndFinish(res.transactions, res.transactionIds ?? []);
  publishEntitlement(summary);
  return summary;
}

/**
 * Fire-and-forget reconcile on native launch: attach the `Transaction.updates`
 * listener (so an approval that lands while the app runs is not lost) and
 * re-verify the Apple ID's current entitlements, so a renewal, a cross-device
 * purchase, or a lapse is reflected without the user tapping "restore".
 * `Transaction.currentEntitlements` never prompts, so this is safe to run
 * silently. No-ops on web and swallows errors.
 */
export async function syncPurchasesSilently(): Promise<void> {
  if (!isNative()) return;
  installTransactionListener();
  try {
    const res = await plugin().restore();
    if (!res.transactions.length) return;
    const summary = await verifyAndFinish(res.transactions, res.transactionIds ?? []);
    publishEntitlement(summary);
  } catch {
    /* offline or no purchases — the webhook keeps server state correct anyway */
  }
}
