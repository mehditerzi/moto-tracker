import { describe, it, expect } from "vitest";
import { encodePolyline, decodePolyline, simplifyRoute, simplifyToBudget, type LatLng } from "./polyline";

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
