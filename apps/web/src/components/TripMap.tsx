import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import {
  baseMapOptions,
  frameItems,
  loadMapKit,
  MARKER_INK,
  prefersDarkScheme,
  ROUTE_WEIGHT,
  routeDistanceKm,
  routeStrokeStyles,
  watchColorScheme,
  colorSchemeValue,
  type MapKitMap,
  type MapKitNS,
} from "@/lib/mapkit";
import { decodePolyline } from "@/lib/polyline";

/** A trip's route drawn on an Apple map, sized for an expandable list row. */
export function TripMap({ route }: { route: string }) {
  const { t, i18n } = useTranslation();
  // The effect below tears the map down when its deps change, so it keys on the
  // language rather than on `t`'s identity — a rebuilt map must be a deliberate
  // event, never a side effect of a re-render.
  const labels = useRef({ start: "", finish: "" });
  labels.current = { start: t("trips.routeStart"), finish: t("trips.routeFinish") };
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef<{ mk: MapKitNS; map: MapKitMap } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "failed">("loading");

  const points = useMemo(() => decodePolyline(route), [route]);
  const km = useMemo(() => routeDistanceKm(points), [points]);

  useEffect(() => {
    let cancelled = false;
    if (points.length < 2) {
      setState("empty");
      return;
    }
    setState("loading");
    loadMapKit()
      .then((mk) => {
        if (cancelled || !ref.current) return;
        const map = new mk.Map(ref.current, {
          // Muted basemap: this is a data view, and desaturating the map is
          // what lets a 5pt lime line own a 208px-tall rectangle.
          ...baseMapOptions(mk, prefersDarkScheme(), true),
          isScrollEnabled: false,
          isZoomEnabled: false,
        });
        live.current = { mk, map };

        const coords = points.map(([lat, lng]) => new mk.Coordinate(lat, lng));
        const styles = routeStrokeStyles(mk, ROUTE_WEIGHT.preview);
        const casing = new mk.PolylineOverlay(coords, { style: styles.casing });
        const core = new mk.PolylineOverlay(coords, { style: styles.core });
        // Overlays paint in insertion order — casing beneath, core on top.
        map.addOverlay(casing);
        map.addOverlay(core);

        // Endpoints, so the route reads as a journey with a direction rather
        // than an anonymous squiggle. Distinct colour *and* glyph *and* title.
        const first = points[0]!;
        const last = points[points.length - 1]!;
        const start = new mk.MarkerAnnotation(new mk.Coordinate(first[0], first[1]), {
          color: MARKER_INK.start,
          glyphText: "A",
          title: labels.current.start,
          accessibilityLabel: labels.current.start,
        });
        const finish = new mk.MarkerAnnotation(new mk.Coordinate(last[0], last[1]), {
          color: MARKER_INK.finish,
          glyphColor: MARKER_INK.onAccent,
          glyphText: "B",
          title: labels.current.finish,
          accessibilityLabel: labels.current.finish,
        });
        map.addAnnotation(start);
        map.addAnnotation(finish);

        // 20px of inset keeps the line and the marker balloons clear of the
        // rounded corners; the shared floors handle a one-block loop.
        frameItems(mk, map, [casing, core, start, finish], points, {
          padding: 20,
          animate: false,
        });
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
      live.current?.map.destroy();
      live.current = null;
    };
  }, [points, i18n.language]);

  // The OS theme can flip while the row is open; only the basemap changes —
  // the route ink is deliberately scheme-independent.
  useEffect(
    () =>
      watchColorScheme((scheme) => {
        const c = live.current;
        if (c) c.map.colorScheme = colorSchemeValue(c.mk, scheme === "dark");
      }),
    [],
  );

  if (state === "empty" || state === "failed") {
    return (
      <p className="py-6 text-center text-[13px] text-muted dark:text-muted-dark">
        {state === "empty" ? t("trips.mapNoRoute") : t("trips.mapFailed")}
      </p>
    );
  }
  return (
    <div className="relative h-52 overflow-hidden rounded-xl">
      {state === "loading" && <Skeleton className="absolute inset-0" />}
      {/* A map is pure geometry to a screen reader — the distance is the point. */}
      <div
        ref={ref}
        role="img"
        aria-label={t("trips.mapAlt", { km: km.toFixed(1) })}
        className="h-full w-full"
      />
    </div>
  );
}
