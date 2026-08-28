import { describe, it, expect } from "vitest";
import type { RidePlace } from "@mototracker/shared";
import { isSamePlace, movePlace, newPlaceId, rememberIn } from "./useRoutePlan";

function place(id: string, lat = 40, lng = 29): RidePlace {
  return { id, name: id, lat, lng, kind: "stop" };
}

describe("movePlace", () => {
  const list = [place("a"), place("b"), place("c")];

  it("moves a stop one slot in either direction", () => {
    expect(movePlace(list, "b", -1).map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(movePlace(list, "b", 1).map((p) => p.id)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at the ends and for an unknown id", () => {
    expect(movePlace(list, "a", -1)).toBe(list);
    expect(movePlace(list, "c", 1)).toBe(list);
    expect(movePlace(list, "zzz", 1)).toBe(list);
  });

  it("does not mutate the input", () => {
    movePlace(list, "b", 1);
    expect(list.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("rememberIn", () => {
  it("puts the newest first and caps the list", () => {
    let recents: RidePlace[] = [];
    for (let i = 0; i < 20; i++) recents = rememberIn(recents, place(`p${i}`, 40 + i * 0.01));
    expect(recents).toHaveLength(12);
    expect(recents[0]!.id).toBe("p19");
  });

  it("de-duplicates by position, not by name", () => {
    const first = rememberIn([], { ...place("a", 40.0001, 29.0001), name: "Shell" });
    const again = rememberIn(first, { ...place("b", 40.0002, 29.0002), name: "Shell Kavacık" });
    expect(again).toHaveLength(1);
    expect(again[0]!.name).toBe("Shell Kavacık"); // the newer name wins
  });
});

describe("isSamePlace", () => {
  it("treats coordinates within about 50 m as the same place", () => {
    expect(isSamePlace(place("a", 40.0, 29.0), place("b", 40.0003, 29.0003))).toBe(true);
    expect(isSamePlace(place("a", 40.0), place("b", 40.01))).toBe(false);
  });
});

describe("newPlaceId", () => {
  it("does not collide across a burst of stops", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPlaceId()));
    expect(ids.size).toBe(200);
  });
});
