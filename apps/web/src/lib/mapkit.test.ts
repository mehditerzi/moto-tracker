import { describe, it, expect } from "vitest";
import {
  isPositionStale,
  MIN_SPAN_LAT_DEG,
  minLngSpanDeg,
  minutesSince,
  POSITION_STALE_MS,
  regionForPoints,
  ROUTE_INK,
  ROUTE_WEIGHT,
  routeDistanceKm,
} from "./mapkit";
import type { LatLng } from "./polyline";

// MapKit itself can't run here (no browser, no token), so the parts that decide
// what the user actually sees — framing, staleness, the route's text
// equivalent — live in pure functions and are pinned down here instead.

describe("regionForPoints", () => {
  it("returns null when there is nothing to frame", () => {
    expect(regionForPoints([])).toBeNull();
    expect(regionForPoints([[NaN, NaN]])).toBeNull();
  });

  it("frames a single-point (degenerate) route at the minimum span", () => {
    const box = regionForPoints([[41.015, 28.979]])!;
    expect(box.centerLat).toBeCloseTo(41.015, 6);
    expect(box.centerLng).toBeCloseTo(28.979, 6);
    expect(box.latDelta).toBe(MIN_SPAN_LAT_DEG);
    // Longitude degrees are shorter at 41°N, so the floor is wider in degrees
    // to cover the same distance on the ground.
    expect(box.lngDelta).toBeGreaterThan(MIN_SPAN_LAT_DEG);
    expect(box.lngDelta).toBeCloseTo(MIN_SPAN_LAT_DEG / Math.cos((41.015 * Math.PI) / 180), 6);
  });

  it("keeps a tight urban loop above the floor rather than zooming to a roof", () => {
    // ~200 m square block.
    const loop: LatLng[] = [
      [41.0000, 29.0000],
      [41.0018, 29.0000],
      [41.0018, 29.0024],
      [41.0000, 29.0024],
      [41.0000, 29.0000],
    ];
    const box = regionForPoints(loop)!;
    expect(box.latDelta).toBe(MIN_SPAN_LAT_DEG);
    expect(box.lngDelta).toBeGreaterThanOrEqual(minLngSpanDeg(box.centerLat));
  });

  it("frames a near-straight motorway run from its dominant axis", () => {
    // ~110 km north, drifting 200 m east.
    const run: LatLng[] = [
      [40.0, 29.0],
      [40.5, 29.001],
      [41.0, 29.002],
    ];
    const box = regionForPoints(run)!;
    expect(box.centerLat).toBeCloseTo(40.5, 6);
    // Dominant axis: padded, never clamped by the floor.
    expect(box.latDelta).toBeCloseTo(1.0 * 1.3, 6);
    // Minor axis: the floor takes over, so the map is not asked for an
    // impossibly thin sliver. MapKit widens it to the view's aspect anyway.
    expect(box.lngDelta).toBeCloseTo(minLngSpanDeg(box.centerLat), 6);
  });

  it("pads a normal route so it never hugs the edge of the frame", () => {
    const box = regionForPoints([
      [40.0, 29.0],
      [40.2, 29.4],
    ])!;
    expect(box.latDelta).toBeCloseTo(0.2 * 1.3, 6);
    expect(box.lngDelta).toBeCloseTo(0.4 * 1.3, 6);
    expect(box.latDelta).toBeGreaterThan(0.2);
    expect(box.lngDelta).toBeGreaterThan(0.4);
  });

  it("ignores non-finite points instead of poisoning the whole region", () => {
    const box = regionForPoints([
      [40.0, 29.0],
      [Number.NaN, 29.2],
      [40.2, 29.4],
    ])!;
    expect(box.centerLat).toBeCloseTo(40.1, 6);
    expect(Number.isFinite(box.latDelta)).toBe(true);
  });

  it("honours an explicit pad and floor", () => {
    const box = regionForPoints([[10, 10], [10.1, 10.1]], { pad: 1, minLatSpan: 0.001 })!;
    expect(box.latDelta).toBeCloseTo(0.1, 6);
  });
});

describe("minLngSpanDeg", () => {
  it("equals the latitude span at the equator and grows towards the poles", () => {
    expect(minLngSpanDeg(0)).toBeCloseTo(MIN_SPAN_LAT_DEG, 6);
    expect(minLngSpanDeg(60)).toBeCloseTo(MIN_SPAN_LAT_DEG * 2, 6);
    expect(minLngSpanDeg(41)).toBeGreaterThan(MIN_SPAN_LAT_DEG);
  });

  it("clamps near the poles so the span cannot explode", () => {
    expect(minLngSpanDeg(89.999)).toBeCloseTo(MIN_SPAN_LAT_DEG / 0.2, 6);
    expect(Number.isFinite(minLngSpanDeg(90))).toBe(true);
  });
});

describe("position staleness", () => {
  const now = 1_700_000_000_000;

  it("treats a fresh fix as live and an old one as stale", () => {
    expect(isPositionStale(now - 1_000, now)).toBe(false);
    expect(isPositionStale(now - (POSITION_STALE_MS - 1), now)).toBe(false);
    expect(isPositionStale(now - POSITION_STALE_MS, now)).toBe(true);
    expect(isPositionStale(now - 600_000, now)).toBe(true);
  });

  it("treats a missing or broken timestamp as stale, never as live", () => {
    expect(isPositionStale(Number.NaN, now)).toBe(true);
    expect(isPositionStale(Number.POSITIVE_INFINITY, now)).toBe(true);
  });

  it("reports whole minutes since the fix, never negative", () => {
    expect(minutesSince(now - 30_000, now)).toBe(0);
    expect(minutesSince(now - 65_000, now)).toBe(1);
    expect(minutesSince(now - 7_200_000, now)).toBe(120);
    // Clock skew: a fix "from the future" must not render as -1 min.
    expect(minutesSince(now + 60_000, now)).toBe(0);
  });
});

describe("routeDistanceKm", () => {
  it("is zero for a degenerate route", () => {
    expect(routeDistanceKm([])).toBe(0);
    expect(routeDistanceKm([[41, 29]])).toBe(0);
  });

  it("measures a known leg (Istanbul → Ankara ≈ 350 km great-circle)", () => {
    const km = routeDistanceKm([
      [41.0082, 28.9784],
      [39.9334, 32.8597],
    ]);
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(360);
  });

  it("sums segments rather than measuring end to end", () => {
    const out = routeDistanceKm([
      [41.0, 29.0],
      [41.1, 29.0],
      [41.0, 29.0],
    ]);
    expect(out).toBeCloseTo(2 * routeDistanceKm([[41.0, 29.0], [41.1, 29.0]]), 6);
  });

  it("skips broken points instead of returning NaN", () => {
    const km = routeDistanceKm([
      [41.0, 29.0],
      [Number.NaN, 29.0],
      [41.1, 29.0],
    ]);
    expect(Number.isFinite(km)).toBe(true);
  });
});

describe("route ink", () => {
  it("keeps the casing strictly wider than the core, so a halo exists", () => {
    for (const w of Object.values(ROUTE_WEIGHT)) {
      expect(w.casing).toBeGreaterThan(w.core);
      // At least 1pt of halo on each side, or it reads as an artefact.
      expect((w.casing - w.core) / 2).toBeGreaterThanOrEqual(1);
    }
  });

  it("is heavy enough to be visible on a phone", () => {
    expect(ROUTE_WEIGHT.preview.core).toBeGreaterThanOrEqual(4);
    expect(ROUTE_WEIGHT.planner.core).toBeGreaterThanOrEqual(6);
  });

  it("uses the accent lime over near-black, not the dimmed lime", () => {
    expect(ROUTE_INK.core).toBe("#E1FF4D");
    expect(ROUTE_INK.casing).toBe("#0A0A0F");
  });
});
