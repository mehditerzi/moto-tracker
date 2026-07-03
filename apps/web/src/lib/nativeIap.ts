/**
 * Native StoreKit 2 bridge (iOS only). Talks to the custom `StoreKit` Capacitor
 * plugin (Swift, see apps/web/ios). The plugin returns Apple's signed JWS
 * transaction strings; we forward them to the API, which verifies them against
 * Apple's root CAs and updates the entitlement. No third-party billing SDK.
 *
 * Every function no-ops / throws `iap_unavailable` on web, so callers must gate
 * on `isNativeIapAvailable()` first.
 */
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./nativeAuth";
import { api } from "./api";
import { queryClient } from "./queryClient";
import { ENTITLEMENT_KEY } from "@/hooks/useEntitlement";
import type { EntitlementSummary } from "@mototracker/shared";

export interface StoreKitProduct {
  id: string;
  displayName: string;
  /** Localized, currency-formatted price string from StoreKit (e.g. "₺100,00"). */
  displayPrice: string;
}

interface StoreKitPlugin {
  getProducts(options: { productIds: string[] }): Promise<{ products: StoreKitProduct[] }>;
  /** Returns the signed JWS transaction(s) for the completed purchase. */
  purchase(options: {
    productId: string;
    /** UUID echoed back in Apple's notifications so they map to this user. */
    appAccountToken?: string;
  }): Promise<{ transactions: string[] }>;
  /** Returns signed JWS for all of the user's current entitlements. */
  restore(): Promise<{ transactions: string[] }>;
}

let _plugin: StoreKitPlugin | null = null;
function plugin(): StoreKitPlugin {
  if (!_plugin) _plugin = registerPlugin<StoreKitPlugin>("StoreKit");
  return _plugin;
}

export function isNativeIapAvailable(): boolean {
  return isNative();
}

export async function fetchProducts(productIds: string[]): Promise<StoreKitProduct[]> {
  if (!isNative()) return [];
  const { products } = await plugin().getProducts({ productIds });
  return products;
}

/** Send verified JWS to the backend and return the updated entitlement. */
async function verifyOnServer(transactions: string[]): Promise<EntitlementSummary> {
  return api<EntitlementSummary>("/api/iap/verify", {
    method: "POST",
    json: { transactions },
  });
}

/** Buy a tier, then have the server verify and grant it. */
export async function purchaseTier(productId: string): Promise<EntitlementSummary> {
  if (!isNative()) throw new Error("iap_unavailable");
  // Plant our user's appAccountToken so Apple's server notifications (renewals,
  // cancellations) map back to this account even before/without a client verify.
  // Non-fatal if it fails — the purchase still verifies via originalTransactionId.
  let appAccountToken: string | undefined;
  try {
    appAccountToken = (await api<{ token: string }>("/api/iap/account-token")).token;
  } catch {
    /* ignore — token is a best-effort mapping aid */
  }
  const { transactions } = await plugin().purchase({ productId, appAccountToken });
  if (!transactions.length) throw new Error("purchase_cancelled");
  return verifyOnServer(transactions);
}

/** Restore previous purchases (e.g. after reinstall / new device). */
export async function restorePurchases(): Promise<EntitlementSummary> {
  if (!isNative()) throw new Error("iap_unavailable");
  const { transactions } = await plugin().restore();
  if (!transactions.length) throw new Error("no_purchases");
  return verifyOnServer(transactions);
}

/**
 * Fire-and-forget reconcile on native launch: re-verify the Apple ID's current
 * entitlements so a renewal, a cross-device purchase, or a lapse is reflected
 * without the user tapping "restore". `Transaction.currentEntitlements` never
 * prompts, so this is safe to run silently. No-ops on web and swallows errors.
 */
export async function syncPurchasesSilently(): Promise<void> {
  if (!isNative()) return;
  try {
    const { transactions } = await plugin().restore();
    if (!transactions.length) return;
    const summary = await verifyOnServer(transactions);
    queryClient.setQueryData(ENTITLEMENT_KEY, summary);
    void queryClient.invalidateQueries({ queryKey: ["bikes"] });
  } catch {
    /* offline or no purchases — the webhook keeps server state correct anyway */
  }
}
