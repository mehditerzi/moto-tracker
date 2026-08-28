import { api } from "./api";
import type { LatLng } from "./polyline";

/**
 * Lazy MapKit JS loader plus the app's shared map vocabulary (route ink,
 * framing, colour scheme). The script is injected only when a map is actually
 * shown, and authorization tokens are minted server-side by /api/mapkit-token
 * (the signing key never reaches the client). MapKit re-invokes the callback
 * itself when a token nears expiry.
 *
 * Everything below the loader is pure and unit-tested (`mapkit.test.ts`) —
 * MapKit itself cannot run in CI, so the geometry and staleness rules are kept
 * out of the components where they'd be untestable.
 */

// MapKit JS ships no types — model just the surface we use.
export interface MapKitSearchResult {
  displayLines?: string[];
  coordinate: { latitude: number; longitude: number };
  name?: string;
  formattedAddress?: string;
}
/** A `mapkit.PolylineOverlay` — `Directions` hands one back, styled or not. */
export interface MapKitPolyline {
  /** The overlay's coordinates; we re-use them to draw the casing beneath. */
  points?: unknown[];
  /** `mapkit.Style` — settable after construction (mapkit.Overlay#style). */
  style?: unknown;
}
export interface MapKitRoute {
  polyline: MapKitPolyline;
  distance: number; // meters
  expectedTravelTime: number; // seconds
}
export interface MapKitShowItemsOptions {
  animate?: boolean;
  padding?: unknown;
  minimumSpan?: unknown;
}
export interface MapKitNS {
  init(opts: { authorizationCallback: (done: (token: string) => void) => void }): void;
  Map: {
    new (el: HTMLElement, opts?: Record<string, unknown>): MapKitMap;
    /** "light" | "dark" | "adaptive" */
    ColorSchemes?: { Light: string; Dark: string; Adaptive?: string };
    MapTypes?: { Standard: string; MutedStandard: string; Hybrid: string; Satellite: string };
  };
  Coordinate: new (lat: number, lng: number) => unknown;
  CoordinateRegion: new (center: unknown, span: unknown) => unknown;
  CoordinateSpan: new (latDelta: number, lngDelta: number) => unknown;
  PolylineOverlay: new (coords: unknown[], opts?: Record<string, unknown>) => MapKitPolyline;
  Style: new (opts: Record<string, unknown>) => unknown;
  MarkerAnnotation: new (coord: unknown, opts?: Record<string, unknown>) => unknown;
  /** Insets for `Map#showItems`, in CSS pixels. */
  Padding?: new (opts: { top: number; right: number; bottom: number; left: number }) => unknown;
  FeatureVisibility?: { Adaptive: string; Hidden: string; Visible: string };
  Search: new (opts?: Record<string, unknown>) => {
    search(
      q: string,
      cb: (err: unknown, data: { places: MapKitSearchResult[] }) => void,
    ): number;
  };
  Directions: new () => {
    route(
      req: { origin: unknown; destination: unknown; transportType?: unknown },
      cb: (err: unknown, data: { routes: MapKitRoute[] }) => void,
    ): number;
  };
  Directions_Transport?: unknown;
}
export interface MapKitMap {
  /** mapkit.Map.ColorSchemes value; settable while the map is live. */
  colorScheme?: string;
  addOverlay(o: unknown): void;
  removeOverlay(o: unknown): void;
  addAnnotation(a: unknown): void;
  removeAnnotation(a: unknown): void;
  setRegionAnimated(region: unknown, animated?: boolean): void;
  /** Frames items with pixel padding. Absent on very old MapKit builds. */
  showItems?: (items: unknown[], opts?: MapKitShowItemsOptions) => unknown;
  addEventListener?: (type: string, listener: (ev: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (ev: unknown) => void) => void;
  destroy(): void;
}

declare global {
  interface Window {
    mapkit?: MapKitNS;
  }
}

const SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
let loading: Promise<MapKitNS> | null = null;

function injectMapKit(): Promise<MapKitNS> {
  if (window.mapkit) return Promise.resolve(window.mapkit);
  return new Promise<MapKitNS>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SRC;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      const mk = window.mapkit;
      if (mk) resolve(mk);
      else reject(new Error("mapkit_load_failed"));
    };
    script.onerror = () => reject(new Error("mapkit_load_failed"));
    document.head.appendChild(script);
  });
}

async function fetchToken(): Promise<string> {
  const r = await api<{ token: string }>("/api/mapkit-token");
  if (!r?.token) throw new Error("mapkit_unauthorized");
  return r.token;
}

/**
 * Resolves with an initialized MapKit namespace, or rejects.
 *
 * The first token is fetched *before* the CDN script is injected: when MapKit
 * is unconfigured the endpoint answers 503, and rejecting here is what lets a
 * caller render an honest "maps are unavailable" state instead of an
 * authorized-but-blank grey rectangle. A rejection also clears the cached
 * promise so re-opening a map retries.
 */
export function loadMapKit(): Promise<MapKitNS> {
  if (!loading) {
    loading = (async () => {
      const first = await fetchToken();
      const mk = await injectMapKit();
      let primed = false;
      mk.init({
        authorizationCallback: (done) => {
          // MapKit asks immediately, then again as the token nears expiry.
          if (!primed) {
            primed = true;
            done(first);
            return;
          }
          fetchToken()
            .then(done)
            .catch(() => done(""));
        },
      });
      return mk;
    })().catch((err: unknown) => {
      loading = null; // allow a retry on the next map open
      throw err;
    });
  }
  return loading;
}

// ─── colour scheme ────────────────────────────────────────────────────────────

export type MapColorScheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * The same signal Tailwind's `darkMode: "media"` uses — the app has no in-app
 * theme toggle, so the OS preference is the single source of truth. Without
 * this a dark-mode user gets a glaring white map inside a near-black app.
 */
export function prefersDarkScheme(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(DARK_QUERY).matches;
}

/** Subscribes to OS light/dark flips. Returns an unsubscribe. */
export function watchColorScheme(cb: (scheme: MapColorScheme) => void): () => void {
  const mql = typeof window !== "undefined" ? window.matchMedia?.(DARK_QUERY) : undefined;
  if (!mql) return () => {};
  const handler = (e: MediaQueryListEvent) => cb(e.matches ? "dark" : "light");
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

/** Maps our boolean onto MapKit's enum, falling back to its documented values. */
export function colorSchemeValue(mk: MapKitNS, dark: boolean): string {
  const schemes = mk.Map.ColorSchemes;
  if (dark) return schemes?.Dark ?? "dark";
  return schemes?.Light ?? "light";
}

/** Options every map in the app shares. `muted` de-emphasises the basemap. */
export function baseMapOptions(mk: MapKitNS, dark: boolean, muted: boolean): Record<string, unknown> {
  const hidden = mk.FeatureVisibility?.Hidden ?? "hidden";
  return {
    colorScheme: colorSchemeValue(mk, dark),
    mapType: muted ? (mk.Map.MapTypes?.MutedStandard ?? "mutedStandard") : (mk.Map.MapTypes?.Standard ?? "standard"),
    isRotationEnabled: false,
    showsMapTypeControl: false,
    showsZoomControl: false,
    showsCompass: hidden,
    showsScale: hidden,
  };
}

// ─── route ink ────────────────────────────────────────────────────────────────

/**
 * A route is drawn as two stacked strokes: a near-black **casing** and a lime
 * **core** on top. A single flat stroke cannot hold up against every basemap —
 * over a park, a motorway shield or a dense block of labels it either
 * disappears or reads as part of the map. The casing gives the line its own
 * edge everywhere, which is the whole difference between a route that looks
 * deliberate and one that looks like debug output.
 *
 * The pair is scheme-independent on purpose: near-black is darker than every
 * surface on Apple's light *and* dark basemaps, and the lime core stays legible
 * against the casing either way. That means an OS theme flip only has to swap
 * `map.colorScheme` — the overlays never need rebuilding.
 */
export const ROUTE_INK = {
  /** `accent` — the app's LED lime. The route is the hero object on the screen. */
  core: "#E1FF4D",
  /** `text` near-black; darker than any basemap surface, light or dark. */
  casing: "#0A0A0F",
} as const;

export interface RouteWeight {
  casing: number;
  core: number;
}

/**
 * Stroke weights in CSS points (MapKit scales for devicePixelRatio itself).
 * `planner` is the half-screen navigation map — Apple Maps' own route is ~7pt,
 * and matching it is what stops the line reading as a hairline. `preview` is
 * the 208px-tall trip row, where a switchbacked mountain route has to stay
 * readable, so the same shape is drawn a little finer.
 */
export const ROUTE_WEIGHT: Record<"planner" | "preview", RouteWeight> = {
  planner: { casing: 11, core: 7 },
  preview: { casing: 8, core: 5 },
};

/** The two `mapkit.Style`s for one route, in draw order (casing first). */
export function routeStrokeStyles(mk: MapKitNS, w: RouteWeight): { casing: unknown; core: unknown } {
  const shared = { lineJoin: "round", lineCap: "round" } as const;
  return {
    casing: new mk.Style({
      ...shared,
      strokeColor: ROUTE_INK.casing,
      strokeOpacity: 0.9,
      lineWidth: w.casing,
    }),
    core: new mk.Style({
      ...shared,
      strokeColor: ROUTE_INK.core,
      strokeOpacity: 1,
      lineWidth: w.core,
    }),
  };
}

/**
 * Builds the casing overlay for a polyline MapKit gave us (Directions returns a
 * ready-made overlay we don't own the geometry of). Returns null when the
 * points aren't reachable, in which case the caller draws the core alone rather
 * than nothing.
 */
export function casingForPolyline(
  mk: MapKitNS,
  polyline: MapKitPolyline,
  w: RouteWeight,
): MapKitPolyline | null {
  const points = polyline.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  return new mk.PolylineOverlay(points, { style: routeStrokeStyles(mk, w).casing });
}

// ─── marker ink ───────────────────────────────────────────────────────────────

/**
 * Markers never rely on colour alone: each also carries a distinct glyph and a
 * title, which is what a colour-blind user (and VoiceOver) actually reads.
 */
export const MARKER_INK = {
  /** Route start — `success`. Glyph "A". */
  start: "#3DD680",
  /** Route finish / destination — `accent`, matching the route core. Glyph "B". */
  finish: "#E1FF4D",
  /** A rider reporting a fresh position — `success`, glyph = their initial. */
  riderLive: "#3DD680",
  /** A rider whose last fix has gone stale — `muted`, so it can't read as live. */
  riderStale: "#6B6B72",
  /** Glyph colour for the light-on-lime markers. */
  onAccent: "#0A0A0F",
} as const;

// ─── live position staleness ──────────────────────────────────────────────────

/**
 * Riders broadcast every 3s. Past 30s (ten missed beats) a pin is a guess, not
 * a position — showing it as live is the one genuinely dangerous thing a group
 * ride map can do, so it goes grey and says how old it is.
 */
export const POSITION_STALE_MS = 30_000;

export function isPositionStale(timestampMs: number, now = Date.now()): boolean {
  if (!Number.isFinite(timestampMs)) return true;
  return now - timestampMs >= POSITION_STALE_MS;
}

/** Whole minutes since a fix, floored at 0 — for "last seen {{m}} min ago". */
export function minutesSince(timestampMs: number, now = Date.now()): number {
  if (!Number.isFinite(timestampMs)) return 0;
  return Math.max(0, Math.floor((now - timestampMs) / 60_000));
}

// ─── framing ──────────────────────────────────────────────────────────────────

export interface RegionBox {
  centerLat: number;
  centerLng: number;
  latDelta: number;
  lngDelta: number;
}

/**
 * ~555 m of latitude: the tightest the map will ever zoom. A trip whose points
 * all land within a car park still gets a neighbourhood view rather than a
 * meaningless close-up of one roof.
 */
export const MIN_SPAN_LAT_DEG = 0.005;

/**
 * The longitude equivalent of `latSpan` at this latitude. A degree of longitude
 * is only ~85 km at Istanbul's 41°N versus 111 km at the equator, so a floor
 * expressed in raw degrees would frame a tight urban loop differently depending
 * on where in the world it is. Clamped so the poles can't explode the span.
 */
export function minLngSpanDeg(lat: number, latSpan: number = MIN_SPAN_LAT_DEG): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  return latSpan / Math.max(Math.abs(cos), 0.2);
}

/**
 * The region that frames `points`, with headroom so the route never hugs the
 * edge, and per-axis floors so degenerate input still yields a sane view.
 *
 * MapKit expands whichever axis is too small for the view's aspect ratio and
 * never shrinks one, so a near-straight motorway run frames correctly from the
 * dominant axis alone. Returns null when there's nothing to frame.
 *
 * Not antimeridian-aware: a route crossing ±180° would frame the long way
 * round. No such trip is reachable in this product.
 */
export function regionForPoints(
  points: readonly LatLng[],
  opts: { pad?: number; minLatSpan?: number } = {},
): RegionBox | null {
  const pad = opts.pad ?? 1.3;
  const minLatSpan = opts.minLatSpan ?? MIN_SPAN_LAT_DEG;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let n = 0;
  for (const p of points) {
    const [lat, lng] = p;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    n++;
  }
  if (n === 0) return null;
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  return {
    centerLat,
    centerLng,
    latDelta: Math.max((maxLat - minLat) * pad, minLatSpan),
    lngDelta: Math.max((maxLng - minLng) * pad, minLngSpanDeg(centerLat, minLatSpan)),
  };
}

/** Frames `items` with pixel insets, falling back to a computed region. */
export function frameItems(
  mk: MapKitNS,
  map: MapKitMap,
  items: unknown[],
  points: readonly LatLng[],
  opts: { padding: number; animate: boolean },
): void {
  const box = regionForPoints(points);
  if (!box) return;
  const minimumSpan = new mk.CoordinateSpan(
    MIN_SPAN_LAT_DEG,
    minLngSpanDeg(box.centerLat),
  );
  if (typeof map.showItems === "function" && items.length > 0) {
    const p = opts.padding;
    map.showItems(items, {
      animate: opts.animate,
      minimumSpan,
      padding: mk.Padding ? new mk.Padding({ top: p, right: p, bottom: p, left: p }) : undefined,
    });
    return;
  }
  map.setRegionAnimated(
    new mk.CoordinateRegion(
      new mk.Coordinate(box.centerLat, box.centerLng),
      new mk.CoordinateSpan(box.latDelta, box.lngDelta),
    ),
    opts.animate,
  );
}

// ─── route description (the map's text alternative) ───────────────────────────

const EARTH_RADIUS_KM = 6371;

/** Great-circle length of a decoded route, in km. */
export function routeDistanceKm(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [lat1, lng1] = points[i - 1]!;
    const [lat2, lng2] = points[i]!;
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) continue;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    total += 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return total;
}
