import { z } from "zod";

/**
 * Monetization model: a user's FIRST vehicle is free. Additional vehicles
 * require an active auto-renewable App Store subscription. Apple has no true
 * per-quantity billing, so "≈50 TRY per extra vehicle/year" is expressed as
 * subscription tiers that each unlock a vehicle ceiling. All tiers live in one
 * App Store subscription group, so a user is on exactly one at a time.
 *
 * This catalog is the single source of truth shared by the API (entitlement
 * resolution + StoreKit verification) and the web/native client (paywall UI and
 * the product IDs to request from StoreKit). Keep the product IDs in exact sync
 * with App Store Connect — a mismatch means a purchase grants nothing.
 */
export const FREE_MAX_VEHICLES = 1;

export interface IapTier {
  /** App Store product identifier (must match App Store Connect exactly). */
  productId: string;
  /** Stable internal tier key (used in the DB and analytics). */
  tier: string;
  /** Max active (non-archived) vehicles this tier unlocks. */
  maxVehicles: number;
  /** Localized display price, for the paywall before StoreKit prices load. */
  displayPriceTry: number;
}

/**
 * Ordered cheapest → most vehicles. `displayPriceTry` is a fallback only — the
 * client always prefers the live localized price StoreKit returns.
 */
export const IAP_TIERS: readonly IapTier[] = [
  {
    productId: "com.medhiterzi.mototracker.garage.3.yearly",
    tier: "garage3",
    maxVehicles: 3,
    displayPriceTry: 100,
  },
  {
    productId: "com.medhiterzi.mototracker.garage.5.yearly",
    tier: "garage5",
    maxVehicles: 5,
    displayPriceTry: 200,
  },
  {
    productId: "com.medhiterzi.mototracker.garage.10.yearly",
    tier: "garage10",
    maxVehicles: 10,
    displayPriceTry: 400,
  },
] as const;

/** All product IDs the client should request from StoreKit. */
export const IAP_PRODUCT_IDS: readonly string[] = IAP_TIERS.map((t) => t.productId);

/** Look up a tier by its App Store product ID (undefined if unknown). */
export function tierForProductId(productId: string): IapTier | undefined {
  return IAP_TIERS.find((t) => t.productId === productId);
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
