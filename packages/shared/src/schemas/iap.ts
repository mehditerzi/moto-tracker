import { z } from "zod";

/**
 * Monetization model: a user's FIRST vehicle is free. More vehicles are sold as
 * **packs** — auto-renewable App Store subscriptions whose pack size is the
 * total active-vehicle ceiling. Pricing is per vehicle (₺20/month or
 * ₺100/year) with a volume discount baked into each pack's price: 10% off at
 * 10+ vehicles, 20% at 20+, capped at 30% from 30 up.
 *
 * Apple has no per-quantity billing, so each sellable pack × period is its own
 * product in App Store Connect, ID pattern:
 *
 *   com.mehditerzi.mototracker.garage.<packSize>.<monthly|yearly>
 *
 * `tierForProductId` PARSES that pattern rather than matching a fixed list, so
 * adding a new pack size in App Store Connect (and to PACK_SIZES for the
 * paywall) needs no server redeploy to be honored. All products live in one
 * subscription group, so a user is on exactly one at a time.
 */
export const FREE_MAX_VEHICLES = 1;

export const IAP_PRODUCT_PREFIX = "com.mehditerzi.mototracker.garage.";

export type IapPeriod = "monthly" | "yearly";

/** Per-vehicle price before volume discount. */
export const UNIT_PRICE_TRY: Record<IapPeriod, number> = { monthly: 20, yearly: 100 };

/** Pack sizes offered on the paywall (must exist in App Store Connect). */
export const PACK_SIZES: readonly number[] = [3, 5, 10, 20, 30, 40, 50];

/** Volume discount by pack size: 10% at 10+, 20% at 20+, 30% from 30 up. */
export function discountFor(packSize: number): number {
  if (packSize >= 30) return 0.3;
  if (packSize >= 20) return 0.2;
  if (packSize >= 10) return 0.1;
  return 0;
}

/** Formula price in ₺ (whole lira) — the App Store price should match this. */
export function packPriceTry(packSize: number, period: IapPeriod): number {
  return Math.round(packSize * UNIT_PRICE_TRY[period] * (1 - discountFor(packSize)));
}

/**
 * Overrides for product IDs Apple has permanently burned — a deleted product's
 * ID can never be reused, even across product types. Key: `<packSize>.<period>`.
 */
export const PRODUCT_ID_OVERRIDES: Record<string, string> = {
  // First created as a NON-consumable by mistake (2026-07-20), then deleted;
  // the subscription lives under the "garaj" segment instead.
  "3.monthly": "com.mehditerzi.mototracker.garaj.3.monthly",
};

export function productIdFor(packSize: number, period: IapPeriod): string {
  return PRODUCT_ID_OVERRIDES[`${packSize}.${period}`] ?? `${IAP_PRODUCT_PREFIX}${packSize}.${period}`;
}

export interface IapTier {
  /** App Store product identifier (must match App Store Connect exactly). */
  productId: string;
  /** Stable internal tier key (used in the DB and analytics), e.g. "garage10-yearly". */
  tier: string;
  /** Max active (non-archived) vehicles this pack unlocks. */
  maxVehicles: number;
  period: IapPeriod;
  /** Formula price, for the paywall before StoreKit's localized price loads. */
  displayPriceTry: number;
}

function tierFor(packSize: number, period: IapPeriod): IapTier {
  return {
    productId: productIdFor(packSize, period),
    tier: `garage${packSize}-${period}`,
    maxVehicles: packSize,
    period,
    displayPriceTry: packPriceTry(packSize, period),
  };
}

/** Every offered pack × period, smallest pack first. */
export const IAP_TIERS: readonly IapTier[] = (["monthly", "yearly"] as const).flatMap((period) =>
  PACK_SIZES.map((n) => tierFor(n, period)),
);

/** All product IDs the client should request from StoreKit. */
export const IAP_PRODUCT_IDS: readonly string[] = IAP_TIERS.map((t) => t.productId);

// "garaj" is the burned-ID fallback segment (see PRODUCT_ID_OVERRIDES).
const PRODUCT_ID_RE = /^com\.mehditerzi\.mototracker\.(?:garage|garaj)\.(\d{1,3})\.(monthly|yearly)$/;

/**
 * Resolve a product ID to its pack. Pattern-based: any garage.<n>.<period> id
 * is honored (1 < n ≤ 500) even if it isn't in PACK_SIZES yet, so packs added
 * in App Store Connect later grant the right ceiling without a redeploy.
 */
export function tierForProductId(productId: string): IapTier | undefined {
  const m = productId.match(PRODUCT_ID_RE);
  if (!m) return undefined;
  const packSize = Number(m[1]);
  if (!Number.isInteger(packSize) || packSize <= FREE_MAX_VEHICLES || packSize > 500) return undefined;
  return tierFor(packSize, m[2] as IapPeriod);
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
