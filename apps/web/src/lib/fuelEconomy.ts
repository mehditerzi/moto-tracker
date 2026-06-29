import type { FuelLog } from "@mototracker/shared";

export interface FuelSummary {
  /** Average litres per 100 km, or null when not enough odometer data. */
  avgL100: number | null;
  /** Average cost per km (₺), or null. */
  costPerKm: number | null;
  /** Total spend across all logged fills that recorded a cost. */
  totalSpend: number;
  /** Spend in the trailing 30 days. */
  last30Spend: number;
  fillCount: number;
}

/**
 * Derive economy/spend from a vehicle's fuel-ups. Economy uses the distance
 * between consecutive odometer readings: over each segment we attribute the
 * litres of the *later* fill (you put back roughly what you burned). The very
 * first fill only anchors the first segment, so its litres aren't counted.
 * Non-monotonic or absurd jumps are skipped.
 */
export function fuelSummary(logs: FuelLog[], now = new Date()): FuelSummary {
  let totalSpend = 0;
  let last30Spend = 0;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  for (const l of logs) {
    if (l.totalCost != null) {
      totalSpend += l.totalCost;
      if (new Date(l.filledOn) >= cutoff) last30Spend += l.totalCost;
    }
  }

  const withOdo = logs
    .filter((l) => l.odometerKm != null)
    .sort((a, b) => (a.odometerKm as number) - (b.odometerKm as number));

  let dist = 0;
  let segLiters = 0;
  let segCost = 0;
  let segCostDist = 0;
  for (let i = 1; i < withOdo.length; i++) {
    const d = (withOdo[i]!.odometerKm as number) - (withOdo[i - 1]!.odometerKm as number);
    if (d <= 0 || d > 100_000) continue;
    dist += d;
    segLiters += withOdo[i]!.liters;
    if (withOdo[i]!.totalCost != null) {
      segCost += withOdo[i]!.totalCost as number;
      segCostDist += d;
    }
  }

  return {
    avgL100: dist > 0 ? (segLiters / dist) * 100 : null,
    costPerKm: segCostDist > 0 ? segCost / segCostDist : null,
    totalSpend,
    last30Spend,
    fillCount: logs.length,
  };
}
