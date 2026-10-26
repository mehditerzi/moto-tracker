/**
 * The privacy zone for shared rides: a posted route loses its first and last
 * PRIVACY_TRIM_M, so a ride that starts at someone's front door does not tell
 * the world where that door is. Routes too short to survive the trim are not
 * shared at all.
 *
 * Polyline encode/decode mirrors apps/web/src/lib/polyline.ts (Google's
 * algorithm, 1e-5) — the format is stored, so both sides must agree forever.
 */
export type LatLng = [number, number];

export const PRIVACY_TRIM_M = 600;

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
  let pLat = 0;
  let pLng = 0;
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lng * 1e5);
    encodeValue(a - pLat, out);
    encodeValue(b - pLng, out);
    pLat = a;
    pLng = b;
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
      } while (byte >= 0x20 && i < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function distM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Drop points within `trimM` (along the path) of either end. */
function trimStart(points: LatLng[], trimM: number): LatLng[] {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += distM(points[i - 1]!, points[i]!);
    if (acc >= trimM) return points.slice(i);
  }
  return [];
}

/** The route to publish, or null when nothing safe is left of it. */
export function privacyTrimmedRoute(encoded: string | null, trimM = PRIVACY_TRIM_M): string | null {
  if (!encoded) return null;
  let pts: LatLng[];
  try {
    pts = decodePolyline(encoded);
  } catch {
    return null;
  }
  if (pts.length < 2) return null;
  const head = trimStart(pts, trimM);
  const both = trimStart(head.reverse(), trimM).reverse();
  return both.length >= 2 ? encodePolyline(both) : null;
}
