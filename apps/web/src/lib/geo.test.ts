import { describe, it, expect } from "vitest";
import {
  cumulativeKm,
  gapBehindKm,
  haversineKm,
  minutesBehind,
  pathLengthKm,
  projectOnPath,
  FALLBACK_SPEED_KMH,
} from "./geo";

/** A straight run north along the 29°E meridian: 0.01° of latitude ≈ 1.111 km. */
const NORTH = [
  { lat: 40.0, lng: 29.0 },
  { lat: 40.01, lng: 29.0 },
  { lat: 40.02, lng: 29.0 },
];

describe("cumulativeKm / pathLengthKm", () => {
  it("starts at zero and accumulates monotonically", () => {
    const cum = cumulativeKm(NORTH);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(1.112, 2);
    expect(cum[2]).toBeCloseTo(2.224, 2);
    expect(pathLengthKm(NORTH)).toBeCloseTo(2.224, 2);
  });

  it("treats a path of fewer than two points as zero length", () => {
    expect(pathLengthKm([])).toBe(0);
    expect(pathLengthKm([{ lat: 40, lng: 29 }])).toBe(0);
  });
});

describe("projectOnPath", () => {
  it("finds the distance along and the distance off the line", () => {
    const p = projectOnPath(NORTH, { lat: 40.005, lng: 29.0 });
    expect(p).not.toBeNull();
    expect(p!.alongKm).toBeCloseTo(0.556, 2);
    expect(p!.offKm).toBeCloseTo(0, 3);
  });

  it("clamps to the ends rather than extrapolating past them", () => {
    const before = projectOnPath(NORTH, { lat: 39.98, lng: 29.0 })!;
    expect(before.alongKm).toBeCloseTo(0, 3);
    const after = projectOnPath(NORTH, { lat: 40.05, lng: 29.0 })!;
    expect(after.alongKm).toBeCloseTo(2.224, 2);
  });

  it("reports how far a rider is from the line", () => {
    const off = projectOnPath(NORTH, { lat: 40.01, lng: 29.01 })!;
    expect(off.offKm).toBeCloseTo(0.852, 2); // ~0.01° of longitude at 40°N
  });

  it("returns null for a degenerate path so callers can fall back", () => {
    expect(projectOnPath([{ lat: 40, lng: 29 }], { lat: 40, lng: 29 })).toBeNull();
  });
});

describe("gapBehindKm", () => {
  /**
   * The case the whole feature exists for: a U-shaped road where two riders are
   * 1.7 km apart in a straight line but 5 km apart along the tarmac they are
   * both on. Reporting the straight line would tell the leader the group is
   * together when it is not.
   */
  const U = [
    { lat: 40.0, lng: 29.0 },
    { lat: 40.02, lng: 29.0 },
    { lat: 40.02, lng: 29.02 },
    { lat: 40.0, lng: 29.02 },
  ];
  const route = { path: U, cum: cumulativeKm(U) };
  const leader = { lat: 40.005, lng: 29.02 }; // near the far end of the U
  const rider = { lat: 40.005, lng: 29.0 }; // still on the first leg

  it("measures along the route when both riders are on it", () => {
    const straight = haversineKm(leader, rider);
    const gap = gapBehindKm(leader, rider, route);
    expect(gap.onRoute).toBe(true);
    expect(gap.km).toBeGreaterThan(straight * 2);
    expect(gap.km).toBeCloseTo(5.05, 1);
  });

  it("falls back to straight-line distance with no route", () => {
    const gap = gapBehindKm(leader, rider);
    expect(gap.onRoute).toBe(false);
    expect(gap.km).toBeCloseTo(haversineKm(leader, rider), 5);
  });

  it("falls back when a rider has strayed off the line", () => {
    const strayed = { lat: 40.005, lng: 29.05 }; // ~2.5 km off the route
    const gap = gapBehindKm(leader, strayed, route);
    expect(gap.onRoute).toBe(false);
  });

  it("never reports a rider ahead of the leader as negatively behind", () => {
    const gap = gapBehindKm(rider, leader, route);
    expect(gap.km).toBe(0);
  });
});

describe("minutesBehind", () => {
  it("uses the leader's speed when it is a real riding speed", () => {
    expect(minutesBehind(30, 60)).toBe(30);
  });

  it("costs a stopped or unknown-speed leader at a cruising pace", () => {
    const expected = Math.round((30 / FALLBACK_SPEED_KMH) * 60);
    expect(minutesBehind(30, null)).toBe(expected);
    expect(minutesBehind(30, 0)).toBe(expected);
  });
});
