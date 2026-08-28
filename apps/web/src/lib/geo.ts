export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle (haversine) distance between two coordinates, in kilometers. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ─── path math (group-ride gaps, next checkpoint) ─────────────────────────────

/**
 * Distance along a path at each vertex, in km. `cum[0]` is 0 and the last entry
 * is the path's total length. Computed once per route and reused for every
 * rider, which is what keeps the per-tick cost of a ten-rider group trivial.
 */
export function cumulativeKm(path: readonly GeoPoint[]): number[] {
  const cum = new Array<number>(path.length);
  let total = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) total += haversineKm(path[i - 1]!, path[i]!);
    cum[i] = total;
  }
  return cum;
}

/** Total length of a path in km (0 for a path of fewer than two points). */
export function pathLengthKm(path: readonly GeoPoint[]): number {
  if (path.length < 2) return 0;
  const cum = cumulativeKm(path);
  return cum[cum.length - 1]!;
}

export interface PathProjection {
  /** How far along the path the nearest point is, in km. */
  alongKm: number;
  /** How far the rider is from the path itself, in km. */
  offKm: number;
  /** Index of the segment start vertex. */
  index: number;
}

/**
 * Nearest point on `path` to `p`.
 *
 * Local flat-earth projection per segment: over the ~100 m a segment spans, the
 * error is far below GPS noise, and it avoids the trigonometry that would make
 * this O(riders × vertices) loop expensive on a long route.
 *
 * Returns null for a degenerate path so callers fall back to straight-line
 * distance rather than reporting a confident zero.
 */
export function projectOnPath(
  path: readonly GeoPoint[],
  p: GeoPoint,
  cum: readonly number[] = cumulativeKm(path),
): PathProjection | null {
  if (path.length < 2) return null;
  const mPerDegLat = 111.32; // km per degree
  let best: PathProjection | null = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const mPerDegLng = mPerDegLat * Math.cos(toRad((a.lat + b.lat) / 2));
    const ax = 0;
    const ay = 0;
    const bx = (b.lng - a.lng) * mPerDegLng;
    const by = (b.lat - a.lat) * mPerDegLat;
    const px = (p.lng - a.lng) * mPerDegLng;
    const py = (p.lat - a.lat) * mPerDegLat;
    const seg2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const tRaw = seg2 > 0 ? (px * bx + py * by) / seg2 : 0;
    const t = Math.max(0, Math.min(1, tRaw));
    const dx = px - t * bx;
    const dy = py - t * by;
    const offKm = Math.sqrt(dx * dx + dy * dy);
    if (!best || offKm < best.offKm) {
      const segLenKm = (cum[i] ?? 0) - (cum[i - 1] ?? 0);
      best = { alongKm: (cum[i - 1] ?? 0) + t * segLenKm, offKm, index: i - 1 };
    }
  }
  return best;
}

/**
 * How far off the planned line a rider may be and still be considered "on it".
 * Wide enough for a parallel service road, a wrong lane on a divided highway
 * and plain GPS drift in a valley; narrow enough that a rider who genuinely
 * took another road stops being measured against a route they are not on.
 */
export const ON_ROUTE_TOLERANCE_KM = 0.35;

/**
 * Distance a rider is behind the leader, in km — the number a group ride
 * actually runs on.
 *
 * With a shared route, both are projected onto it and the answer is the
 * difference in progress: the honest figure on a switchbacked mountain road,
 * where a straight line between two riders can read 800 m while the road
 * between them is 4 km. Without a route (or when either rider has strayed off
 * it) it degrades to straight-line distance, which is never *wrong*, just
 * optimistic — and that is the safer direction for a number a rider glances at.
 *
 * Negative results are clamped to 0: a rider ahead of the leader is not
 * "behind by -2 km", they are simply not behind.
 */
export function gapBehindKm(
  leader: GeoPoint,
  rider: GeoPoint,
  route?: { path: readonly GeoPoint[]; cum: readonly number[] },
): { km: number; onRoute: boolean } {
  if (route && route.path.length >= 2) {
    const l = projectOnPath(route.path, leader, route.cum);
    const r = projectOnPath(route.path, rider, route.cum);
    if (
      l &&
      r &&
      l.offKm <= ON_ROUTE_TOLERANCE_KM &&
      r.offKm <= ON_ROUTE_TOLERANCE_KM
    ) {
      return { km: Math.max(0, l.alongKm - r.alongKm), onRoute: true };
    }
  }
  return { km: haversineKm(leader, rider), onRoute: false };
}

/**
 * Minutes to cover `km` at `speedKmh`. A stopped or unknown-speed rider is
 * costed at a conservative cruising speed instead of infinity — "∞ dk behind"
 * is useless, "12 dk behind" is a decision.
 */
export const FALLBACK_SPEED_KMH = 45;

export function minutesBehind(km: number, speedKmh: number | null): number {
  const speed = speedKmh != null && speedKmh > 8 ? speedKmh : FALLBACK_SPEED_KMH;
  return Math.round((km / speed) * 60);
}
