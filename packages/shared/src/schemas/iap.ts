import { z } from "zod";

/**
 * Monetization: the FIRST vehicle is free; more are sold as vehicle PACKS
 * (pack size = total active-vehicle ceiling). Each pack is offered over several
 * TERMS. Two kinds of term:
 *
 *   - **Auto-renewable** (6 months, 1 year) — normal App Store subscriptions in
 *     the "Garaj Aboneliği" group; Apple renews them and sends notifications.
 *   - **Non-renewing** (2, 3, 5, 10 years) — one-time In-App Purchases. Apple
 *     does NOT auto-renew or restore these; access lasts `months` from purchase
 *     and OUR server is the source of truth (it stores the entitlement + expiry,
 *     which survives a reinstall / new device because the user has an account).
 *
 * Price is per vehicle per term, with a pack volume discount baked in (10% at
 * 10+, 20% at 20+, 30% from 30). Apple has no per-quantity billing, so each
 * pack × term is its own product; the server resolves product IDs by pattern.
 *
 * Product ID: `com.mehditerzi.mototracker.garage.<packSize>.<termKey>`
 * (the 1-year token is `yearly` for continuity with the originally-created
 * products — do not rename it.)
 */
export const FREE_MAX_VEHICLES = 1;

export const IAP_PRODUCT_PREFIX = "com.mehditerzi.mototracker.garage.";

export interface IapTerm {
  /** Product-id token and stable internal key. */
  key: string;
  /** Access duration in months (also the non-renewing expiry offset). */
  months: number;
  /** Price per vehicle, in ₺, before the pack volume discount. */
  perVehicleTry: number;
  /** true = auto-renewable subscription; false = non-renewing one-time IAP. */
  renewable: boolean;
}

export const IAP_TERMS: readonly IapTerm[] = [
  { key: "6mo", months: 6, perVehicleTry: 60, renewable: true },
  { key: "yearly", months: 12, perVehicleTry: 100, renewable: true },
  { key: "2yr", months: 24, perVehicleTry: 200, renewable: false },
  { key: "3yr", months: 36, perVehicleTry: 300, renewable: false },
  { key: "5yr", months: 60, perVehicleTry: 500, renewable: false },
  { key: "10yr", months: 120, perVehicleTry: 1000, renewable: false },
];

/** Pack sizes offered on the paywall (must exist in App Store Connect). */
export const PACK_SIZES: readonly number[] = [3, 5, 10, 20, 30, 40, 50];

/** Volume discount by pack size: 10% at 10+, 20% at 20+, 30% from 30 up. */
export function discountFor(packSize: number): number {
  if (packSize >= 30) return 0.3;
  if (packSize >= 20) return 0.2;
  if (packSize >= 10) return 0.1;
  return 0;
}

export function termFor(key: string): IapTerm | undefined {
  return IAP_TERMS.find((t) => t.key === key);
}

/** Formula price in ₺ (whole lira) — the App Store price should match this. */
export function packPriceTry(packSize: number, term: IapTerm): number {
  return Math.round(packSize * term.perVehicleTry * (1 - discountFor(packSize)));
}

export function productIdFor(packSize: number, termKey: string): string {
  return `${IAP_PRODUCT_PREFIX}${packSize}.${termKey}`;
}

export interface IapTier {
  /** App Store product identifier (must match App Store Connect exactly). */
  productId: string;
  /** Stable internal tier key, e.g. "garage10-yearly". */
  tier: string;
  /** Max active (non-archived) vehicles this pack unlocks. */
  maxVehicles: number;
  termKey: string;
  termMonths: number;
  /** true = auto-renewable; false = non-renewing one-time IAP. */
  renewable: boolean;
  /** Formula price, for the paywall before StoreKit's localized price loads. */
  displayPriceTry: number;
}

function tierFor(packSize: number, term: IapTerm): IapTier {
  return {
    productId: productIdFor(packSize, term.key),
    tier: `garage${packSize}-${term.key}`,
    maxVehicles: packSize,
    termKey: term.key,
    termMonths: term.months,
    renewable: term.renewable,
    displayPriceTry: packPriceTry(packSize, term),
  };
}

/** Every offered pack × term. */
export const IAP_TIERS: readonly IapTier[] = IAP_TERMS.flatMap((term) =>
  PACK_SIZES.map((n) => tierFor(n, term)),
);

/** All product IDs the client should request from StoreKit. */
export const IAP_PRODUCT_IDS: readonly string[] = IAP_TIERS.map((t) => t.productId);

const PRODUCT_ID_RE =
  /^com\.mehditerzi\.mototracker\.garage\.(\d{1,3})\.(6mo|yearly|2yr|3yr|5yr|10yr)$/;

/**
 * Resolve a product ID to its pack + term. Pattern-based, so new pack sizes
 * added in App Store Connect are honored without a redeploy.
 */
export function tierForProductId(productId: string): IapTier | undefined {
  const m = productId.match(PRODUCT_ID_RE);
  if (!m) return undefined;
  const packSize = Number(m[1]);
  const term = termFor(m[2]!);
  if (!term || !Number.isInteger(packSize) || packSize <= FREE_MAX_VEHICLES || packSize > 500) {
    return undefined;
  }
  return tierFor(packSize, term);
}

/**
 * Effective expiry (ms) for a verified transaction. Auto-renewable terms use
 * Apple's expiresDate; non-renewing terms have no Apple expiry, so it's
 * computed as purchase date + the term's duration.
 */
export function computeExpiryMs(
  tier: IapTier,
  purchaseMs: number | null,
  appleExpiresMs: number | null,
): number | null {
  if (tier.renewable) return appleExpiresMs;
  if (purchaseMs === null) return null;
  const d = new Date(purchaseMs);
  d.setMonth(d.getMonth() + tier.termMonths);
  return d.getTime();
}

/** Subscription lifecycle status we track locally. */
export const entitlementStatusSchema = z.enum(["free", "active", "grace", "expired"]);
export type EntitlementStatus = z.infer<typeof entitlementStatusSchema>;

/**
 * What `GET /api/entitlement` returns — everything the client needs to decide
 * whether the add-vehicle button is enabled and what the paywall should say.
 */
export const entitlementSummarySchema = z.object({
  /** Current tier key, or "free". */
  tier: z.string(),
  productId: z.string().nullable(),
  status: entitlementStatusSchema,
  /** Ceiling on active vehicles right now. */
  maxVehicles: z.number().int().min(0),
  /** How many active (non-archived) vehicles the user currently has. */
  activeVehicles: z.number().int().min(0),
  /** Convenience: activeVehicles < maxVehicles. */
  canAddVehicle: z.boolean(),
  /** ISO timestamp the current period ends, or null on the free tier. */
  expiresAt: z.string().nullable(),
});
export type EntitlementSummary = z.infer<typeof entitlementSummarySchema>;
