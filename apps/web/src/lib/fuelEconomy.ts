import type { FuelLog } from "@mototracker/shared";

export interface FuelSummary {
  /** Average litres per 100 km, or null when not enough odometer data. */
  avgL100: number | null;
  /** Average cost per km (₺), or null. */
  costPerKm: number | null;
  /** Weighted average ₺/L across fills that recorded both cost and litres. */
  pricePerLiter: number | null;
  /** Total spend across all logged fills that recorded a cost. */
  totalSpend: number;
  /** Spend in the trailing 30 days. */
  last30Spend: number;
  fillCount: number;
}

/** Chronological order: fill date, then insertion order for same-day fills. */
function byTime(a: FuelLog, b: FuelLog): number {
  if (a.filledOn !== b.filledOn) return a.filledOn < b.filledOn ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

/** An odometer jump this large between fills is OCR/typo garbage, not driving. */
const MAX_SEGMENT_KM = 100_000;

interface Segment {
  /** ISO date of the fill that closed the segment. */
  date: string;
  km: number;
  liters: number;
  /** Total cost of the segment's fills, or null when any fill lacks a cost. */
  cost: number | null;
}

/**
 * Tank-to-tank segments: each spans from one *full* fill with an odometer
 * reading to the next. The litres (and costs) of everything pumped after the
 * anchor — partial fills included, with or without their own odometer — are
 * attributed to the segment, because a brimmed tank means you put back exactly
 * what you burned since the last brim. Partial fills can contribute litres but
 * never open or close a segment. Non-monotonic or absurd odometer jumps
 * discard the segment and re-anchor.
 */
export function economySegments(logs: FuelLog[]): Segment[] {
  const ordered = [...logs].sort(byTime);
  const segments: Segment[] = [];

  let anchorOdo: number | null = null;
  let liters = 0;
  let cost: number | null = 0;

  for (const l of ordered) {
    const canAnchor = l.isFull && l.odometerKm != null;
    if (anchorOdo == null) {
      // Fills before the first full+odometer fill can't be measured.
      if (canAnchor) anchorOdo = l.odometerKm as number;
      continue;
    }

    liters += l.liters;
    if (cost != null && l.totalCost != null) cost += l.totalCost;
    else cost = null;

    if (!canAnchor) continue;
    const km = (l.odometerKm as number) - anchorOdo;
    if (km > 0 && km <= MAX_SEGMENT_KM && liters > 0) {
      segments.push({ date: l.filledOn, km, liters, cost });
    }
    anchorOdo = l.odometerKm as number;
    liters = 0;
    cost = 0;
  }
  return segments;
}

/** Derive economy/spend from a vehicle's fuel-ups. */
export function fuelSummary(logs: FuelLog[], now = new Date()): FuelSummary {
  let totalSpend = 0;
  let last30Spend = 0;
  let pricedCost = 0;
  let pricedLiters = 0;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  for (const l of logs) {
    if (l.totalCost != null) {
      totalSpend += l.totalCost;
      if (new Date(l.filledOn) >= cutoff) last30Spend += l.totalCost;
      if (l.liters > 0) {
        pricedCost += l.totalCost;
        pricedLiters += l.liters;
      }
    }
  }

  let dist = 0;
  let segLiters = 0;
  let segCost = 0;
  let segCostDist = 0;
  for (const s of economySegments(logs)) {
    dist += s.km;
    segLiters += s.liters;
    if (s.cost != null) {
      segCost += s.cost;
      segCostDist += s.km;
    }
  }

  return {
    avgL100: dist > 0 ? (segLiters / dist) * 100 : null,
    costPerKm: segCostDist > 0 ? segCost / segCostDist : null,
    pricePerLiter: pricedLiters > 0 ? pricedCost / pricedLiters : null,
    totalSpend,
    last30Spend,
    fillCount: logs.length,
  };
}

export interface EconomyPoint {
  date: string;
  l100: number;
}

/** Per-segment L/100km over time — one point per closed tank-to-tank segment. */
export function economySeries(logs: FuelLog[]): EconomyPoint[] {
  return economySegments(logs).map((s) => ({ date: s.date, l100: (s.liters / s.km) * 100 }));
}

export interface MonthSpend {
  /** `YYYY-MM` */
  month: string;
  total: number;
}

/**
 * Fuel spend bucketed by calendar month for the trailing `months` months
 * (oldest first), including empty months so bars keep their time scale.
 */
export function monthlySpend(logs: FuelLog[], months = 6, now = new Date()): MonthSpend[] {
  const buckets = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
  }
  for (const l of logs) {
    if (l.totalCost == null) continue;
    const key = l.filledOn.slice(0, 7);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) as number) + l.totalCost);
  }
  return [...buckets.entries()].map(([month, total]) => ({ month, total }));
}
