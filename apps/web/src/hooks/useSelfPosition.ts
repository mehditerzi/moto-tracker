import { useEffect, useRef, useState } from "react";
import type { GeoPoint } from "@/lib/geo";

/**
 * The rider's own position, for the map screen's own needs: the origin of a
 * planned route, the target of "recentre", and the coordinate behind "add a
 * stop where I am".
 *
 * Deliberately a plain foreground `watchPosition` and deliberately **off during
 * a group ride** — the ride channel is already running the background watcher
 * and its roster contains our own row, so running a second GPS client for the
 * same coordinate would cost battery on the one screen where battery is
 * scarcest.
 */
export function useSelfPosition(enabled: boolean): GeoPoint | null {
  const [point, setPoint] = useState<GeoPoint | null>(null);
  // Held across enable/disable flips so the map keeps a usable origin the
  // instant a ride ends, rather than blanking until the next fix arrives.
  const last = useRef<GeoPoint | null>(null);

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude };
        last.current = next;
        setPoint(next);
      },
      () => {
        /* denied or unavailable — the UI asks for permission where it needs it */
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return point ?? last.current;
}
