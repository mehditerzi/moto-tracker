import { useSyncExternalStore } from "react";
import type { CheckpointKind, RidePlace } from "@mototracker/shared";

/**
 * The rider's planned route: an ordered list of checkpoints, kept on the device.
 *
 * **Deliberately client-only.** A server-side table of the places a user
 * intends to ride to would be a persistent record of their movements in
 * advance — exactly the trail the group-ride feature goes out of its way not to
 * leave (see `apps/api/src/lib/rideHub.ts`). localStorage survives an app
 * restart, which is the actual requirement, and it survives it without anyone
 * but the rider ever holding the list.
 *
 * Shape is versioned and every read is defensive: this is user-writable storage
 * that a two-year-old build may have written, and a malformed plan must degrade
 * to "no plan", never to a crash on the roadside.
 */

const PLAN_KEY = "mototracker.routePlan";
const RECENTS_KEY = "mototracker.ridePlaces";
/** Enough to be genuinely faster than typing; short enough to scan at a glance. */
const MAX_RECENTS = 12;
const SCHEMA_VERSION = 1;

const EMPTY: readonly RidePlace[] = [];

const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const KINDS: readonly CheckpointKind[] = ["stop", "fuel", "food", "view", "regroup"];

function isPlace(v: unknown): v is RidePlace {
  const o = v as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o === "object" &&
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.lat === "number" &&
    Number.isFinite(o.lat) &&
    typeof o.lng === "number" &&
    Number.isFinite(o.lng) &&
    KINDS.includes(o.kind as CheckpointKind)
  );
}

function readList(key: string): RidePlace[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { v?: number; places?: unknown } | unknown;
    const places = (parsed as { places?: unknown })?.places;
    if (!Array.isArray(places)) return [];
    return places.filter(isPlace);
  } catch {
    return [];
  }
}

function writeList(key: string, places: RidePlace[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, places }));
  } catch {
    /* private mode / quota — the plan just doesn't survive a restart */
  }
}

// useSyncExternalStore compares snapshots by identity, so the parsed arrays are
// cached and only replaced when we write. Re-parsing per render would loop.
let planCache: RidePlace[] | null = null;
let recentsCache: RidePlace[] | null = null;

function planSnapshot(): RidePlace[] {
  if (!planCache) planCache = readList(PLAN_KEY);
  return planCache;
}
function recentsSnapshot(): RidePlace[] {
  if (!recentsCache) recentsCache = readList(RECENTS_KEY);
  return recentsCache;
}
function serverSnapshot(): RidePlace[] {
  return EMPTY as RidePlace[];
}

function setPlan(next: RidePlace[]): void {
  planCache = next;
  writeList(PLAN_KEY, next);
  emit();
}

function setRecents(next: RidePlace[]): void {
  recentsCache = next;
  writeList(RECENTS_KEY, next);
  emit();
}

export function newPlaceId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── pure list operations (unit-tested) ───────────────────────────────────────

/** Moves the item at `id` one slot toward the start (-1) or end (+1). */
export function movePlace(places: readonly RidePlace[], id: string, dir: -1 | 1): RidePlace[] {
  const from = places.findIndex((p) => p.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= places.length) return places as RidePlace[];
  const next = [...places];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * ~55 m. Two searches for the same petrol station rarely return byte-identical
 * coordinates, and a recents list with the same place four times is a recents
 * list nobody uses.
 */
const SAME_PLACE_DEG = 0.0005;

export function isSamePlace(a: RidePlace, b: RidePlace): boolean {
  return Math.abs(a.lat - b.lat) < SAME_PLACE_DEG && Math.abs(a.lng - b.lng) < SAME_PLACE_DEG;
}

/** Most-recent-first, de-duplicated by position, capped. */
export function rememberIn(recents: readonly RidePlace[], place: RidePlace): RidePlace[] {
  return [place, ...recents.filter((p) => !isSamePlace(p, place))].slice(0, MAX_RECENTS);
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export interface RoutePlan {
  stops: RidePlace[];
  recents: RidePlace[];
  /** Appends a checkpoint and remembers it for one-tap re-use later. */
  addStop: (place: Omit<RidePlace, "id"> & { id?: string }) => RidePlace;
  removeStop: (id: string) => void;
  moveStop: (id: string, dir: -1 | 1) => void;
  setKind: (id: string, kind: CheckpointKind) => void;
  clear: () => void;
}

export function useRoutePlan(): RoutePlan {
  const stops = useSyncExternalStore(subscribe, planSnapshot, serverSnapshot);
  const recents = useSyncExternalStore(subscribe, recentsSnapshot, serverSnapshot);

  return {
    stops,
    recents,
    addStop(place) {
      const full: RidePlace = { ...place, id: place.id ?? newPlaceId() };
      setPlan([...planSnapshot(), full]);
      setRecents(rememberIn(recentsSnapshot(), full));
      return full;
    },
    removeStop(id) {
      setPlan(planSnapshot().filter((p) => p.id !== id));
    },
    moveStop(id, dir) {
      setPlan(movePlace(planSnapshot(), id, dir));
    },
    setKind(id, kind) {
      setPlan(planSnapshot().map((p) => (p.id === id ? { ...p, kind } : p)));
    },
    clear() {
      setPlan([]);
    },
  };
}

/** Test seam: drop the in-memory caches so a fresh read hits storage again. */
export function resetRoutePlanCache(): void {
  planCache = null;
  recentsCache = null;
  emit();
}
