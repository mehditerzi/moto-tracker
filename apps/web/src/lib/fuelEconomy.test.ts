import { describe, it, expect } from "vitest";
import { fuelSummary } from "./fuelEconomy";
import type { FuelLog } from "@mototracker/shared";

function log(p: Partial<FuelLog>): FuelLog {
  return {
    id: Math.random().toString(36).slice(2),
    userId: "u",
    bikeId: "b",
    filledOn: "2026-06-01",
    liters: 0,
    totalCost: null,
    odometerKm: null,
    isFull: true,
    notes: null,
    createdAt: "2026-06-01",
    ...p,
  };
}

describe("fuelSummary", () => {
  it("returns nulls with no odometer data", () => {
    const s = fuelSummary([log({ liters: 30 })]);
    expect(s.avgL100).toBeNull();
    expect(s.costPerKm).toBeNull();
    expect(s.fillCount).toBe(1);
  });

  it("computes L/100km and ₺/km from segments", () => {
    // odo 1000 → 1500 (500 km) with the 1500-fill adding 30 L at ₺900.
    const s = fuelSummary([
      log({ odometerKm: 1000, liters: 25, totalCost: 750 }),
      log({ odometerKm: 1500, liters: 30, totalCost: 900 }),
    ]);
    // 30 L over 500 km → 6 L/100km; 900 ₺ over 500 km → 1.8 ₺/km
    expect(s.avgL100).toBeCloseTo(6, 5);
    expect(s.costPerKm).toBeCloseTo(1.8, 5);
  });

  it("sums total spend and skips zero-distance segments", () => {
    const s = fuelSummary([
      log({ odometerKm: 1000, liters: 20, totalCost: 600 }),
      log({ odometerKm: 1000, liters: 20, totalCost: 600 }), // same odo → d=0 → skipped
    ]);
    expect(s.totalSpend).toBe(1200);
    expect(s.avgL100).toBeNull(); // no valid segment
  });
});
