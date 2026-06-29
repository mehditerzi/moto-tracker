import { describe, it, expect } from "vitest";
import { TripDetector, type Sample } from "./tripTracking";
import { haversineKm } from "./geo";

// A point ~111 m north of the previous one per 0.001° latitude.
function north(lat: number, lng: number, t: number, speed: number): Sample {
  return { lat, lng, t, speed, accuracy: 10 };
}

describe("haversineKm", () => {
  it("is ~0 for identical points", () => {
    expect(haversineKm({ lat: 41, lng: 29 }, { lat: 41, lng: 29 })).toBeCloseTo(0, 5);
  });
  it("matches a known distance (1° latitude ≈ 111.19 km)", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
  });
});

describe("TripDetector", () => {
  it("does not start a trip while stationary", () => {
    const d = new TripDetector();
    let lat = 41;
    for (let i = 0; i < 10; i++) {
      expect(d.push(north(lat, 29, i * 1000, 0))).toBeNull();
    }
  });

  it("detects a drive, accumulates distance, and ends after a long stop", () => {
    const d = new TripDetector();
    let result = null as ReturnType<TripDetector["push"]> | null;
    let lat = 41;
    let t = 0;
    // Drive north at ~20 m/s for ~200 samples spaced 1s apart (~0.00018°/s).
    for (let i = 0; i < 400; i++) {
      lat += 0.00018; // ~20 m per second step
      t += 1000;
      result = d.push({ lat, lng: 29, t, speed: 20, accuracy: 8 });
      expect(result).toBeNull();
    }
    // Now sit still long enough to end the trip (>3 min of speed ~0).
    for (let i = 0; i < 200 && !result; i++) {
      t += 1000;
      result = d.push({ lat, lng: 29, t, speed: 0, accuracy: 8 });
    }
    expect(result).not.toBeNull();
    // ~400 steps * ~20 m ≈ 8 km — assert it's in a sane range and > 0.
    expect(result!.distanceKm).toBeGreaterThan(6);
    expect(result!.distanceKm).toBeLessThan(10);
    expect(result!.pointCount).toBeGreaterThan(300);
    expect(new Date(result!.endedAt).getTime()).toBeGreaterThan(
      new Date(result!.startedAt).getTime(),
    );
  });

  it("ignores GPS glitch segments (impossible speed between fixes)", () => {
    const d = new TripDetector();
    // Start moving.
    let t = 0;
    let lat = 41;
    for (let i = 0; i < 5; i++) {
      lat += 0.0002;
      t += 1000;
      d.push({ lat, lng: 29, t, speed: 20, accuracy: 8 });
    }
    const before = d.flush(t); // capture distance so far by ending
    // Re-run with a teleport spike and confirm it doesn't blow up distance.
    const d2 = new TripDetector();
    t = 0;
    lat = 41;
    for (let i = 0; i < 5; i++) {
      lat += 0.0002;
      t += 1000;
      d2.push({ lat, lng: 29, t, speed: 20, accuracy: 8 });
    }
    t += 1000;
    d2.push({ lat: 50, lng: 29, t, speed: 20, accuracy: 8 }); // ~1000 km jump in 1s
    const after = d2.flush(t);
    expect(after!.distanceKm).toBeCloseTo(before!.distanceKm, 1);
  });

  it("flush ends an in-progress trip and returns null when idle", () => {
    const d = new TripDetector();
    expect(d.flush(1000)).toBeNull();
  });
});
