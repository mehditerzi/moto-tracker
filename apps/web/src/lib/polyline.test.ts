import { describe, it, expect } from "vitest";
import {
  encodePolyline,
  decodePolyline,
  encodeWithinBudget,
  simplifyRoute,
  simplifyToBudget,
  type LatLng,
} from "./polyline";

describe("polyline encode/decode", () => {
  it("round-trips at 1e-5 precision", () => {
    const pts: LatLng[] = [
      [41.00823, 28.97836], // İstanbul
      [40.76671, 29.91652],
      [40.18257, 29.06687], // Bursa
    ];
    const decoded = decodePolyline(encodePolyline(pts));
    expect(decoded.length).toBe(3);
    decoded.forEach(([lat, lng], i) => {
      expect(lat).toBeCloseTo(pts[i]![0], 5);
      expect(lng).toBeCloseTo(pts[i]![1], 5);
    });
  });

  it("matches the canonical reference encoding", () => {
    // The worked example from Google's polyline algorithm documentation.
    expect(
      encodePolyline([
        [38.5, -120.2],
        [40.7, -120.95],
        [43.252, -126.453],
      ]),
    ).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("handles empty and single-point inputs", () => {
    expect(decodePolyline(encodePolyline([]))).toEqual([]);
    expect(decodePolyline(encodePolyline([[41, 29]]))).toEqual([[41, 29]]);
  });
});

describe("simplifyRoute", () => {
  it("drops collinear middle points but keeps corners", () => {
    const pts: LatLng[] = [
      [41.0, 29.0],
      [41.0, 29.001], // on the straight line — dropped
      [41.0, 29.002],
      [41.002, 29.002], // a real corner — kept
    ];
    const out = simplifyRoute(pts, 20);
    expect(out[0]).toEqual([41.0, 29.0]);
    expect(out[out.length - 1]).toEqual([41.002, 29.002]);
    expect(out.length).toBeLessThan(pts.length);
    expect(out).toContainEqual([41.0, 29.002]);
  });

  it("keeps a significant detour", () => {
    const pts: LatLng[] = [
      [41.0, 29.0],
      [41.01, 29.005], // ~1 km off the straight line
      [41.0, 29.01],
    ];
    expect(simplifyRoute(pts, 20).length).toBe(3);
  });
});

describe("simplifyToBudget", () => {
  it("stays under the point budget on a dense route", () => {
    // A jagged 5000-point zigzag that plain simplification wouldn't collapse.
    const pts: LatLng[] = Array.from({ length: 5000 }, (_, i) => [
      41 + i * 0.0005 + (i % 2 ? 0.0004 : 0),
      29 + i * 0.0005,
    ]);
    const out = simplifyToBudget(pts, 100, 20);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

describe("encodeWithinBudget", () => {
  /** A long, wiggly route — the kind that would blow the ride hub's frame cap. */
  function wiggly(n: number): LatLng[] {
    return Array.from({ length: n }, (_, i): LatLng => [
      40 + i * 0.001 + Math.sin(i / 3) * 0.0008,
      29 + i * 0.001 + Math.cos(i / 5) * 0.0008,
    ]);
  }

  it("stays inside the budget for a route that would otherwise overflow it", () => {
    const pts = wiggly(4000);
    expect(encodePolyline(pts).length).toBeGreaterThan(8000);
    const encoded = encodeWithinBudget(pts, 8000);
    expect(encoded.length).toBeLessThanOrEqual(8000);
    // Still a route, and still the same route: the ends are untouched and the
    // decoded line never wanders far from where it started.
    const back = decodePolyline(encoded);
    expect(back.length).toBeGreaterThan(2);
    expect(back[0]![0]).toBeCloseTo(pts[0]![0], 4);
    expect(back[back.length - 1]![0]).toBeCloseTo(pts[pts.length - 1]![0], 4);
  });

  it("leaves a route that already fits alone", () => {
    const pts = wiggly(20);
    expect(decodePolyline(encodeWithinBudget(pts, 8000)).length).toBeGreaterThan(1);
  });

  it("survives degenerate input", () => {
    expect(encodeWithinBudget([], 8000)).toBe("");
    expect(decodePolyline(encodeWithinBudget([[41, 29]], 8000))).toEqual([[41, 29]]);
  });
});
