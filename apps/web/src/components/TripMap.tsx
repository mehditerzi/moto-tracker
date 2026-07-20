import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { loadMapKit, type MapKitMap } from "@/lib/mapkit";
import { decodePolyline } from "@/lib/polyline";

/** A trip's route drawn on an Apple map, sized for an expandable list row. */
export function TripMap({ route }: { route: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    let map: MapKitMap | null = null;
    loadMapKit()
      .then((mk) => {
        if (cancelled || !ref.current) return;
        const points = decodePolyline(route);
        if (points.length < 2) {
          setState("failed");
          return;
        }
        map = new mk.Map(ref.current, {
          isRotationEnabled: false,
          showsMapTypeControl: false,
          showsZoomControl: false,
        });
        const coords = points.map(([lat, lng]) => new mk.Coordinate(lat, lng));
        map.addOverlay(
          new mk.PolylineOverlay(coords, {
            style: new mk.Style({ strokeColor: "#A8C235", lineWidth: 4, lineJoin: "round" }),
          }),
        );
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const [lat, lng] of points) {
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        }
        map.setRegionAnimated(
          new mk.CoordinateRegion(
            new mk.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
            // 1.4× so the route doesn't hug the edges; floor for near-straight lines.
            new mk.CoordinateSpan(
              Math.max((maxLat - minLat) * 1.4, 0.01),
              Math.max((maxLng - minLng) * 1.4, 0.01),
            ),
          ),
          false,
        );
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
      map?.destroy();
    };
  }, [route]);

  if (state === "failed") {
    return (
      <p className="py-6 text-center text-[13px] text-muted dark:text-muted-dark">
        {t("trips.mapFailed")}
      </p>
    );
  }
  return (
    <div className="relative h-52 overflow-hidden rounded-xl">
      {state === "loading" && <Skeleton className="absolute inset-0" />}
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
