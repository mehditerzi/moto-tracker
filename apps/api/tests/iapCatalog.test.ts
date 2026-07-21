import { describe, it, expect } from "vitest";
import {
  tierForProductId,
  packPriceTry,
  termFor,
  computeExpiryMs,
  IAP_TIERS,
  IAP_PRODUCT_IDS,
  productIdFor,
} from "@mototracker/shared";

describe("IAP catalog — terms", () => {
  it("exposes 42 products: 7 packs × 6 terms", () => {
    expect(IAP_TIERS).toHaveLength(42);
    expect(new Set(IAP_PRODUCT_IDS).size).toBe(42);
  });

  it("resolves every term token, renewable and non-renewing", () => {
    const y = tierForProductId("com.mehditerzi.mototracker.garage.3.yearly");
    expect(y).toMatchObject({ maxVehicles: 3, termMonths: 12, renewable: true });
    const six = tierForProductId("com.mehditerzi.mototracker.garage.5.6mo");
    expect(six).toMatchObject({ maxVehicles: 5, termMonths: 6, renewable: true });
    const ten = tierForProductId("com.mehditerzi.mototracker.garage.10.10yr");
    expect(ten).toMatchObject({ maxVehicles: 10, termMonths: 120, renewable: false });
  });

  it("rejects the removed monthly token and junk", () => {
    expect(tierForProductId("com.mehditerzi.mototracker.garage.3.monthly")).toBeUndefined();
    expect(tierForProductId("com.mehditerzi.mototracker.garaj.3.monthly")).toBeUndefined();
    expect(tierForProductId("com.other.app.garage.3.yearly")).toBeUndefined();
  });

  it("prices per vehicle per term with pack discounts", () => {
    // 3-pack (no discount): 3 × perVehicle
    expect(packPriceTry(3, termFor("yearly")!)).toBe(300);
    expect(packPriceTry(3, termFor("6mo")!)).toBe(180);
    expect(packPriceTry(3, termFor("10yr")!)).toBe(3000);
    // 10-pack (−10%): 10 × 100 × 0.9
    expect(packPriceTry(10, termFor("yearly")!)).toBe(900);
    // 30-pack (−30%): 30 × 1000 × 0.7
    expect(packPriceTry(30, termFor("10yr")!)).toBe(21000);
  });

  it("computes expiry: Apple date for renewable, purchase+term for non-renewing", () => {
    const renew = tierForProductId(productIdFor(3, "yearly"))!;
    const appleExp = Date.UTC(2027, 0, 1);
    expect(computeExpiryMs(renew, Date.UTC(2026, 0, 1), appleExp)).toBe(appleExp);

    const nonRenew = tierForProductId(productIdFor(5, "2yr"))!;
    const purchase = Date.UTC(2026, 6, 21);
    // +24 months → 2028-07-21
    expect(computeExpiryMs(nonRenew, purchase, null)).toBe(Date.UTC(2028, 6, 21));
  });
});
