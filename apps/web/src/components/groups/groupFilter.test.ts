import { describe, it, expect } from "vitest";
import { filterByGroup, resolveGroupFilter } from "./GroupFilterBar";

/**
 * The two pure decisions behind the garage's group filter. Both exist because
 * of a specific way the screen can lie to somebody:
 *
 *   - `resolveGroupFilter` stops a deleted or left group leaving the garage
 *     filtered to nothing, which reads as "my vehicles are gone";
 *   - `filterByGroup` has to handle a vehicle in SEVERAL groups (migration 029),
 *     which is the whole point of the feature and the case a single-group model
 *     could not express.
 */

const bikes = [
  { id: "monster", groupIds: ["ducatis", "motors"] },
  { id: "panigale", groupIds: ["ducatis"] },
  { id: "corolla", groupIds: [] },
];

describe("filterByGroup", () => {
  it("passes the whole garage through when nothing is selected", () => {
    expect(filterByGroup(bikes, null).map((b) => b.id)).toEqual([
      "monster",
      "panigale",
      "corolla",
    ]);
  });

  it("selects a vehicle through ANY of its groups", () => {
    // The Monster is in both collections, so it appears under both — and
    // exactly once under each.
    expect(filterByGroup(bikes, "ducatis").map((b) => b.id)).toEqual(["monster", "panigale"]);
    expect(filterByGroup(bikes, "motors").map((b) => b.id)).toEqual(["monster"]);
  });

  it("leaves ungrouped vehicles out of every group", () => {
    expect(filterByGroup(bikes, "ducatis").map((b) => b.id)).not.toContain("corolla");
  });

  it("answers empty for a group with nothing in it", () => {
    expect(filterByGroup(bikes, "bmws")).toEqual([]);
  });

  it("does not mutate or alias the input list", () => {
    const out = filterByGroup(bikes, null);
    expect(out).not.toBe(bikes);
    out.pop();
    expect(bikes).toHaveLength(3);
  });
});

describe("resolveGroupFilter", () => {
  const groups = [{ id: "ducatis" }, { id: "motors" }];

  it("keeps a filter that still exists", () => {
    expect(resolveGroupFilter("ducatis", groups)).toBe("ducatis");
  });

  it("falls back to ALL when the group has gone", () => {
    // Deleted, or left, or a cache that has moved on. Showing an empty garage
    // here is the bug this prevents.
    expect(resolveGroupFilter("ducatis", [])).toBeNull();
    expect(resolveGroupFilter("bmws", groups)).toBeNull();
  });

  it("leaves the unfiltered state alone", () => {
    expect(resolveGroupFilter(null, groups)).toBeNull();
    expect(resolveGroupFilter(null, [])).toBeNull();
  });
});
