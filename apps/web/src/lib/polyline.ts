/**
 * Encoded polylines (Google's algorithm, 1e-5 precision) + route simplification.
 * Dependency-free on purpose: routes are stored server-side as opaque encoded
 * strings, so encode/decode must stay stable forever.
 */

export type LatLng = [lat: number, lng: number];

function encodeValue(value: number, out: string[]): void {
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

export function encodePolyline(points: LatLng[]): string {
  const out: string[] = [];
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    encodeValue(iLat - prevLat, out);
    encodeValue(iLng - prevLng, out);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out.join("");
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    for (const which of [0, 1] as const) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(i++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Perpendicular distance (meters, equirectangular approx) from p to segment a–b. */
function perpDistanceM(p: LatLng, a: LatLng, b: LatLng): number {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  const px = (p[1] - a[1]) * mPerDegLng;
  const py = (p[0] - a[0]) * mPerDegLat;
  const bx = (b[1] - a[1]) * mPerDegLng;
  const by = (b[0] - a[0]) * mPerDegLat;
  const segLen2 = bx * bx + by * by;
  const t = segLen2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / segLen2)) : 0;
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Douglas-Peucker, iterative (a mountain-road route can recurse deep). */
export function simplifyRoute(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistanceM(points[i]!, points[start]!, points[end]!);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDist > toleranceM) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Simplify to at most `maxPoints`, loosening tolerance until it fits — keeps
 * the stored payload bounded no matter how long the ride was.
 */
export function simplifyToBudget(points: LatLng[], maxPoints = 1000, toleranceM = 20): LatLng[] {
  let result = simplifyRoute(points, toleranceM);
  let tol = toleranceM;
  while (result.length > maxPoints && tol < 10_000) {
    tol *= 2;
    result = simplifyRoute(result, tol);
  }
  return result;
}

/**
 * Encode to at most `maxChars`, loosening the simplification until it fits.
 *
 * Unlike `simplifyToBudget` the ceiling here is the *encoded* length, because
 * the constraint being satisfied is a wire limit — the ride hub's 16 KiB frame
 * cap — not a point count. A route the group is following is worth more coarse
 * than absent, so this always returns something (the two endpoints in the
 * limit) rather than giving up.
 */
export function encodeWithinBudget(points: LatLng[], maxChars: number): string {
  if (points.length < 2) return encodePolyline(points);
  let result = simplifyToBudget(points, 1200, 15);
  let encoded = encodePolyline(result);
  let tol = 15;
  while (encoded.length > maxChars && tol < 100_000 && result.length > 2) {
    tol *= 2;
    result = simplifyRoute(result, tol);
    encoded = encodePolyline(result);
  }
  return encoded;
}
