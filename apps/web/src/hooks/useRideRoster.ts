import { useMemo } from "react";
import type { RidePlace, RidePosition } from "@mototracker/shared";
import { decodePolyline } from "@/lib/polyline";
import {
  cumulativeKm,
  gapBehindKm,
  haversineKm,
  minutesBehind,
  projectOnPath,
  type GeoPoint,
} from "@/lib/geo";
import { minutesSince, riderStatus, type RiderStatus } from "@/lib/mapkit";
import type { RideMember } from "@/hooks/useRide";

/**
 * Turns a raw roster into the two answers a group ride is actually run on:
 * **who is where** and **who has fallen behind**.
 *
 * The leader is the ride's owner. That is a deliberate choice over "whoever is
 * furthest along": leadership on a real ride is social, not geometric — the
 * person who knows the route leads, and if they stop for fuel the group has not
 * suddenly acquired a new leader in Bursa.
 */

export interface RiderRow {
  userId: string;
  name: string;
  isLeader: boolean;
  isSelf: boolean;
  status: RiderStatus;
  pos: RidePosition | null;
  /** Minutes since this rider's last fix (0 while fresh). */
  ageMin: number;
  /** Distance behind the leader, km. Null when either side has no fix. */
  gapKm: number | null;
  /** Rough minutes behind at the group's pace. Null when gapKm is. */
  gapMin: number | null;
  /** True when the gap was measured along the shared route, not as the crow flies. */
  alongRoute: boolean;
  /** The last rider — the one the group waits for. */
  isSweep: boolean;
  /** Ground speed in km/h, when the fix carried one. */
  speedKmh: number | null;
}

/**
 * Below this, riders are effectively together (traffic lights, a fuel stop
 * forecourt) and calling someone "the sweep" is noise rather than information.
 */
const SWEEP_MIN_GAP_KM = 0.25;

export interface RosterInput {
  members: RideMember[];
  selfUserId: string | null;
  ownerId: string | null;
  /** Decoded shared route, when the leader has shared one. */
  path?: readonly GeoPoint[];
  cum?: readonly number[];
  now?: number;
}

export function buildRoster(input: RosterInput): RiderRow[] {
  const now = input.now ?? Date.now();
  const route =
    input.path && input.path.length >= 2 && input.cum
      ? { path: input.path, cum: input.cum }
      : undefined;

  const leader = input.members.find((m) =>
    input.ownerId ? m.userId === input.ownerId : m.isOwner,
  );
  const leaderPos = leader?.pos ?? null;
  const leaderFresh = leaderPos && riderStatus(leaderPos, now) !== "stale" ? leaderPos : null;

  const rows: RiderRow[] = input.members.map((m) => {
    const pos = m.pos ?? null;
    const status = riderStatus(pos, now);
    const isLeader = leader ? m.userId === leader.userId : false;
    let gapKm: number | null = null;
    let alongRoute = false;
    // A gap measured against a stale leader position is a gap against a ghost.
    if (!isLeader && pos && leaderFresh && status !== "stale") {
      const gap = gapBehindKm(leaderFresh, pos, route);
      gapKm = gap.km;
      alongRoute = gap.onRoute;
    }
    const speedKmh = pos?.speed != null && pos.speed >= 0 ? pos.speed * 3.6 : null;
    return {
      userId: m.userId,
      name: m.name,
      isLeader,
      isSelf: m.userId === input.selfUserId,
      status,
      pos,
      ageMin: pos ? minutesSince(pos.t, now) : 0,
      gapKm,
      gapMin:
        gapKm == null
          ? null
          : minutesBehind(gapKm, leaderFresh?.speed != null ? leaderFresh.speed * 3.6 : null),
      alongRoute,
      isSweep: false,
      speedKmh,
    };
  });

  // Sweep = the largest real gap. Marked on exactly one rider, because "the
  // last rider" is a role the group assigns to one person, not a colour band.
  let sweep: RiderRow | null = null;
  for (const r of rows) {
    if (r.gapKm != null && r.gapKm >= SWEEP_MIN_GAP_KM && (!sweep || r.gapKm > sweep.gapKm!)) {
      sweep = r;
    }
  }
  if (sweep) sweep.isSweep = true;

  // Leader first, then closest-to-furthest, then anyone with no fix at all.
  // That is the order a rider reads the list in: me and the front, the tail,
  // the unknowns.
  return rows.sort((a, b) => {
    if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
    const av = a.gapKm ?? Number.POSITIVE_INFINITY;
    const bv = b.gapKm ?? Number.POSITIVE_INFINITY;
    if (av !== bv) return av - bv;
    return a.name.localeCompare(b.name);
  });
}

export interface NextCheckpoint {
  place: RidePlace;
  /** Index in the plan, 1-based — what the map marker's glyph shows. */
  number: number;
  km: number;
}

/**
 * The stop the rider is heading for next: the first checkpoint further along
 * the route than they are. Falls back to nearest-ahead-by-straight-line when
 * the rider is off the line (or there is no line), so the answer degrades to
 * "the closest one you haven't reached" rather than disappearing.
 */
export function nextCheckpoint(
  stops: readonly RidePlace[],
  self: GeoPoint | null,
  path?: readonly GeoPoint[],
  cum?: readonly number[],
): NextCheckpoint | null {
  if (stops.length === 0 || !self) return null;

  if (path && path.length >= 2 && cum) {
    const me = projectOnPath(path, self, cum);
    if (me) {
      let best: NextCheckpoint | null = null;
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i]!;
        const at = projectOnPath(path, stop, cum);
        if (!at || at.alongKm <= me.alongKm) continue;
        const km = at.alongKm - me.alongKm;
        if (!best || km < best.km) best = { place: stop, number: i + 1, km };
      }
      if (best) return best;
    }
  }

  let best: NextCheckpoint | null = null;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    const km = haversineKm(self, stop);
    if (!best || km < best.km) best = { place: stop, number: i + 1, km };
  }
  return best;
}

/** Decoded form of a shared route, memoized on the encoded string. */
export interface DecodedRoute {
  path: GeoPoint[];
  cum: number[];
}

export function useDecodedRoute(line: string | null | undefined): DecodedRoute | null {
  return useMemo(() => {
    if (!line) return null;
    const points = decodePolyline(line);
    if (points.length < 2) return null;
    const path = points.map(([lat, lng]) => ({ lat, lng }));
    return { path, cum: cumulativeKm(path) };
  }, [line]);
}
