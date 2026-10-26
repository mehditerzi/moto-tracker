import { useMemo } from "react";
import { decodePolyline } from "@/lib/polyline";
import { cn } from "@/lib/cn";

/**
 * A route as a drawing: no map tiles, no network, no location services — the
 * shape of the ride in lime on a dark grid, the way the share card draws it.
 * Fast enough for a feed of dozens.
 */
export function RouteThumb({ route, className }: { route: string; className?: string }) {
  const d = useMemo(() => {
    let pts: [number, number][];
    try {
      pts = decodePolyline(route);
    } catch {
      return null;
    }
    if (pts.length < 2) return null;
    const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xy = pts.map(([la, ln]) => [ln * k, -la] as const);
    const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 320, H = 180, pad = 18;
    const s = Math.min((W - pad * 2) / Math.max(maxX - minX, 1e-6), (H - pad * 2) / Math.max(maxY - minY, 1e-6));
    const ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
    const P = xy.map(([x, y]) => [ox + (x - minX) * s, oy + (y - minY) * s] as const);
    return {
      path: P.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" "),
      start: P[0]!,
      end: P[P.length - 1]!,
    };
  }, [route]);
  if (!d) return null;
  return (
    <svg viewBox="0 0 320 180" className={cn("block w-full bg-[#0E1013]", className)} aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="rt-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </pattern>
        <filter id="rt-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <rect width="320" height="180" fill="url(#rt-grid)" />
      <path d={d.path} fill="none" stroke="rgba(225,255,77,0.55)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" filter="url(#rt-glow)" />
      <path d={d.path} fill="none" stroke="#E1FF4D" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={d.start[0]} cy={d.start[1]} r="5" fill="#0E1013" stroke="#fff" strokeWidth="2.5" />
      <circle cx={d.end[0]} cy={d.end[1]} r="5" fill="#0E1013" stroke="#E1FF4D" strokeWidth="2.5" />
    </svg>
  );
}
