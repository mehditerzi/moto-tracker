import { describe, it, expect } from "vitest";
import { fuelSummary, economySeries, monthlySpend } from "./fuelEconomy";
import type { FuelLog } from "@mototracker/shared";

let seq = 0;
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
    sourceDocumentId: null,
    // Monotonic so same-day fills keep their insertion order under byTime.
    createdAt: `2026-06-01T00:00:${String(seq++).padStart(2, "0")}`,
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

  it("attributes partial-fill litres to the segment without anchoring on them", () => {
    // Full at 1000, partial 10 L (no odo), full 20 L at 1500 → 30 L / 500 km.
    const s = fuelSummary([
      log({ filledOn: "2026-06-01", odometerKm: 1000, liters: 25 }),
      log({ filledOn: "2026-06-05", liters: 10, isFull: false }),
      log({ filledOn: "2026-06-10", odometerKm: 1500, liters: 20 }),
    ]);
    expect(s.avgL100).toBeCloseTo(6, 5);
  });

  it("a partial fill with an odometer reading does not close a segment", () => {
    const s = fuelSummary([
      log({ filledOn: "2026-06-01", odometerKm: 1000, liters: 25 }),
      log({ filledOn: "2026-06-05", odometerKm: 1200, liters: 8, isFull: false }),
      log({ filledOn: "2026-06-10", odometerKm: 1500, liters: 22 }),
    ]);
    // one segment: 1000 → 1500, litres 8 + 22
    expect(s.avgL100).toBeCloseTo(6, 5);
  });

  it("ignores partial fills before the first full anchor", () => {
    const s = fuelSummary([
      log({ filledOn: "2026-06-01", liters: 10, isFull: false }),
      log({ filledOn: "2026-06-02", odometerKm: 1000, liters: 25 }),
      log({ filledOn: "2026-06-10", odometerKm: 1500, liters: 30 }),
    ]);
    expect(s.avgL100).toBeCloseTo(6, 5);
  });

  it("segment cost is dropped when any fill in it lacks a cost", () => {
    const s = fuelSummary([
      log({ filledOn: "2026-06-01", odometerKm: 1000, liters: 25, totalCost: 750 }),
      log({ filledOn: "2026-06-05", liters: 10, isFull: false }), // no cost
      log({ filledOn: "2026-06-10", odometerKm: 1500, liters: 20, totalCost: 600 }),
    ]);
    expect(s.avgL100).toBeCloseTo(6, 5);
    expect(s.costPerKm).toBeNull();
  });

  it("computes weighted ₺/L across priced fills", () => {
    const s = fuelSummary([
      log({ liters: 20, totalCost: 1000 }), // 50 ₺/L
      log({ liters: 10, totalCost: 800 }), // 80 ₺/L
    ]);
    // (1000 + 800) / 30
    expect(s.pricePerLiter).toBeCloseTo(60, 5);
  });
});

describe("economySeries", () => {
  it("emits one point per closed segment, dated by the closing fill", () => {
    const pts = economySeries([
      log({ filledOn: "2026-05-01", odometerKm: 1000, liters: 25 }),
      log({ filledOn: "2026-05-15", odometerKm: 1500, liters: 30 }),
      log({ filledOn: "2026-06-01", odometerKm: 2000, liters: 20 }),
    ]);
    expect(pts).toEqual([
      { date: "2026-05-15", l100: 6 },
      { date: "2026-06-01", l100: 4 },
    ]);
  });
});

describe("monthlySpend", () => {
  it("buckets trailing months oldest-first, including empty ones", () => {
    const now = new Date(2026, 6, 3); // 2026-07-03
    const rows = monthlySpend(
      [
        log({ filledOn: "2026-07-01", liters: 20, totalCost: 1000 }),
        log({ filledOn: "2026-05-20", liters: 20, totalCost: 900 }),
        log({ filledOn: "2025-01-01", liters: 20, totalCost: 500 }), // outside window
      ],
      3,
      now,
    );
    expect(rows).toEqual([
      { month: "2026-05", total: 900 },
      { month: "2026-06", total: 0 },
      { month: "2026-07", total: 1000 },
    ]);
  });
});
