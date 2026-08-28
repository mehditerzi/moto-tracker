import { describe, it, expect } from "vitest";
import type { RidePlace } from "@mototracker/shared";
import { buildRoster, nextCheckpoint } from "./useRideRoster";
import { cumulativeKm } from "@/lib/geo";
import type { RideMember } from "./useRide";

const NOW = 1_700_000_000_000;

function member(
  userId: string,
  name: string,
  pos?: { lat: number; lng: number; speed?: number | null; ageMs?: number },
): RideMember {
  return {
    userId,
    name,
    pos: pos
      ? {
          lat: pos.lat,
          lng: pos.lng,
          speed: pos.speed ?? 20,
          t: NOW - (pos.ageMs ?? 0),
        }
      : null,
  };
}

describe("buildRoster", () => {
  it("puts the leader first and orders the rest closest-first", () => {
    const rows = buildRoster({
      members: [
        member("far", "Zeynep", { lat: 40.0, lng: 29.0 }),
        member("lead", "Ali", { lat: 40.05, lng: 29.0 }),
        member("near", "Barış", { lat: 40.04, lng: 29.0 }),
      ],
      selfUserId: "near",
      ownerId: "lead",
      now: NOW,
    });
    expect(rows.map((r) => r.userId)).toEqual(["lead", "near", "far"]);
    expect(rows[0]!.isLeader).toBe(true);
    expect(rows[0]!.gapKm).toBeNull(); // the leader is not behind themselves
    expect(rows[1]!.isSelf).toBe(true);
    expect(rows[2]!.gapKm).toBeCloseTo(5.56, 1);
  });

  it("marks exactly one sweep — the rider furthest behind", () => {
    const rows = buildRoster({
      members: [
        member("lead", "Ali", { lat: 40.05, lng: 29.0 }),
        member("mid", "Barış", { lat: 40.04, lng: 29.0 }),
        member("last", "Zeynep", { lat: 40.0, lng: 29.0 }),
      ],
      selfUserId: "lead",
      ownerId: "lead",
      now: NOW,
    });
    expect(rows.filter((r) => r.isSweep).map((r) => r.userId)).toEqual(["last"]);
  });

  it("does not call anyone the sweep while the group is bunched up", () => {
    const rows = buildRoster({
      members: [
        member("lead", "Ali", { lat: 40.0, lng: 29.0 }),
        member("b", "Barış", { lat: 40.001, lng: 29.0 }), // ~110 m back
      ],
      selfUserId: "lead",
      ownerId: "lead",
      now: NOW,
    });
    expect(rows.some((r) => r.isSweep)).toBe(false);
  });

  it("measures the gap along a shared route rather than through the hills", () => {
    const path = [
      { lat: 40.0, lng: 29.0 },
      { lat: 40.02, lng: 29.0 },
      { lat: 40.02, lng: 29.02 },
      { lat: 40.0, lng: 29.02 },
    ];
    const rows = buildRoster({
      members: [
        member("lead", "Ali", { lat: 40.005, lng: 29.02 }),
        member("back", "Barış", { lat: 40.005, lng: 29.0 }),
      ],
      selfUserId: "lead",
      ownerId: "lead",
      path,
      cum: cumulativeKm(path),
      now: NOW,
    });
    const back = rows.find((r) => r.userId === "back")!;
    expect(back.alongRoute).toBe(true);
    expect(back.gapKm).toBeCloseTo(5.05, 1);
    expect(back.gapMin).toBeGreaterThan(0);
  });

  it("never measures a gap against a stale rider, in either direction", () => {
    const stale = buildRoster({
      members: [
        member("lead", "Ali", { lat: 40.05, lng: 29.0 }),
        member("gone", "Barış", { lat: 40.0, lng: 29.0, ageMs: 120_000 }),
      ],
      selfUserId: "lead",
      ownerId: "lead",
      now: NOW,
    });
    const gone = stale.find((r) => r.userId === "gone")!;
    expect(gone.status).toBe("stale");
    expect(gone.gapKm).toBeNull();

    const leaderStale = buildRoster({
      members: [
        member("lead", "Ali", { lat: 40.05, lng: 29.0, ageMs: 120_000 }),
        member("b", "Barış", { lat: 40.0, lng: 29.0 }),
      ],
      selfUserId: "b",
      ownerId: "lead",
      now: NOW,
    });
    expect(leaderStale.find((r) => r.userId === "b")!.gapKm).toBeNull();
  });

  it("distinguishes a rider who has stopped from one who is riding", () => {
    const rows = buildRoster({
      members: [
        member("a", "Ali", { lat: 40.0, lng: 29.0, speed: 0.2 }),
        member("b", "Barış", { lat: 40.0, lng: 29.0, speed: 25 }),
        member("c", "Can"),
      ],
      selfUserId: "a",
      ownerId: "a",
      now: NOW,
    });
    expect(rows.find((r) => r.userId === "a")!.status).toBe("stopped");
    expect(rows.find((r) => r.userId === "b")!.status).toBe("moving");
    expect(rows.find((r) => r.userId === "c")!.status).toBe("offline");
  });
});

describe("nextCheckpoint", () => {
  const path = [
    { lat: 40.0, lng: 29.0 },
    { lat: 40.05, lng: 29.0 },
  ];
  const cum = cumulativeKm(path);
  const stops: RidePlace[] = [
    { id: "1", name: "Benzinlik", lat: 40.01, lng: 29.0, kind: "fuel" },
    { id: "2", name: "Kahvaltı", lat: 40.03, lng: 29.0, kind: "food" },
  ];

  it("skips checkpoints already passed", () => {
    const next = nextCheckpoint(stops, { lat: 40.02, lng: 29.0 }, path, cum);
    expect(next?.place.id).toBe("2");
    expect(next?.number).toBe(2);
    expect(next?.km).toBeCloseTo(1.112, 1);
  });

  it("falls back to the nearest checkpoint with no route to project onto", () => {
    const next = nextCheckpoint(stops, { lat: 40.029, lng: 29.0 });
    expect(next?.place.id).toBe("2");
  });

  it("is null with no stops or no position", () => {
    expect(nextCheckpoint([], { lat: 40, lng: 29 })).toBeNull();
    expect(nextCheckpoint(stops, null)).toBeNull();
  });
});
