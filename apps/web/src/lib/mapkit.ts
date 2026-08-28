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
/** `mapkit.Coordinate`. Read back off overlays and search results. */
export interface MapKitCoordinate {
  latitude: number;
  longitude: number;
}
export interface MapKitSearchResult {
  displayLines?: string[];
  coordinate: MapKitCoordinate;
  name?: string;
  formattedAddress?: string;
}
/** A `mapkit.PolylineOverlay` — `Directions` hands one back, styled or not. */
export interface MapKitPolyline {
  /** The overlay's coordinates; we re-use them to draw the casing beneath. */
  points?: MapKitCoordinate[];
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
  Directions: {
    new (opts?: Record<string, unknown>): {
      route(
        req: {
          origin: unknown;
          destination: unknown;
          transportType?: unknown;
          requestsAlternateRoutes?: boolean;
        },
        cb: (err: unknown, data: { routes: MapKitRoute[] }) => void,
      ): number;
    };
    /** `mapkit.Directions.Transport` — Automobile is the closest to a bike. */
    Transport?: { Automobile: string; Walking: string };
  };
  /**
   * Reverse geocoding, used to give a dropped checkpoint a real name instead of
   * a pair of coordinates. Optional in the type because a name is a nicety —
   * every call site has a usable fallback if the namespace lacks it.
   */
  Geocoder?: new (opts?: Record<string, unknown>) => {
    reverseLookup(
      coordinate: unknown,
      cb: (err: unknown, data: { results: MapKitSearchResult[] }) => void,
    ): number;
  };
}
export interface MapKitMap {
  /** mapkit.Map.ColorSchemes value; settable while the map is live. */
  colorScheme?: string;
  /** `mapkit.CoordinateRegion` currently displayed — biases search results. */
  region?: unknown;
  /** `mapkit.Coordinate` at the centre of the view; the "drop a pin here" target. */
  center?: MapKitCoordinate;
  setCenterAnimated?: (center: unknown, animated?: boolean) => void;
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

// ─── multi-leg routing ────────────────────────────────────────────────────────

/**
 * MapKit JS `Directions` has no waypoint parameter — it routes one origin to
 * one destination. A multi-stop plan is therefore literally a chain of legs,
 * which is also why MAX_STOPS exists: every stop is another network round trip.
 */
export interface PlannedLeg {
  /** The overlay MapKit handed back, ready to style and add to the map. */
  polyline: MapKitPolyline;
  points: LatLng[];
  km: number;
  minutes: number;
}

/** Coordinates off an overlay MapKit built, as our own plain tuples. */
export function polylinePoints(polyline: MapKitPolyline): LatLng[] {
  const points = polyline.points;
  if (!Array.isArray(points)) return [];
  const out: LatLng[] = [];
  for (const p of points) {
    if (p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
      out.push([p.latitude, p.longitude]);
    }
  }
  return out;
}

/**
 * Automobile is the closest transport MapKit offers to a motorcycle: same road
 * network, same restrictions that matter (motorway access, one-ways). Walking
 * would happily route a rider down a staircase.
 */
function automobile(mk: MapKitNS): unknown {
  return mk.Directions.Transport?.Automobile ?? "Automobile";
}

/** One origin→destination leg, promisified. Rejects on a routing failure. */
export function routeLeg(mk: MapKitNS, from: LatLng, to: LatLng): Promise<PlannedLeg> {
  return new Promise((resolve, reject) => {
    new mk.Directions().route(
      {
        origin: new mk.Coordinate(from[0], from[1]),
        destination: new mk.Coordinate(to[0], to[1]),
        transportType: automobile(mk),
        requestsAlternateRoutes: false,
      },
      (err, data) => {
        const route = data?.routes?.[0];
        if (err || !route) {
          reject(err instanceof Error ? err : new Error("route_failed"));
          return;
        }
        resolve({
          polyline: route.polyline,
          points: polylinePoints(route.polyline),
          km: route.distance / 1000,
          minutes: route.expectedTravelTime / 60,
        });
      },
    );
  });
}

/**
 * Routes through every waypoint in order. Sequential rather than parallel: the
 * Directions service is quota'd per app, and firing twelve requests at once on
 * a phone's connection is how you get a burst of failures instead of a route.
 *
 * `onLeg` reports each leg as it lands so the map can draw progressively — a
 * rider who added a fifth stop sees the first four legs stay put rather than
 * the whole line blinking out while the last one is fetched.
 */
export async function routeThrough(
  mk: MapKitNS,
  waypoints: readonly LatLng[],
  onLeg?: (leg: PlannedLeg, index: number) => void,
): Promise<PlannedLeg[]> {
  const legs: PlannedLeg[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const leg = await routeLeg(mk, waypoints[i - 1]!, waypoints[i]!);
    legs.push(leg);
    onLeg?.(leg, i - 1);
  }
  return legs;
}

/**
 * A human name for a dropped pin. Best-effort by design: a checkpoint with no
 * name is still a checkpoint, so every failure resolves to null rather than
 * blocking the rider on a network call they never asked for.
 */
export function reverseLookupName(mk: MapKitNS, point: LatLng): Promise<string | null> {
  const Geocoder = mk.Geocoder;
  if (!Geocoder) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (name: string | null) => {
      if (!settled) {
        settled = true;
        resolve(name);
      }
    };
    // A geocode that never calls back must not leave the "adding a stop" UI
    // spinning at the roadside.
    setTimeout(() => done(null), 4000);
    try {
      new Geocoder({ language: navigator.language }).reverseLookup(
        new mk.Coordinate(point[0], point[1]),
        (err, data) => {
          const first = data?.results?.[0];
          done(err || !first ? null : (first.name ?? first.formattedAddress ?? null));
        },
      );
    } catch {
      done(null);
    }
  });
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
  /** A rider stopped at the roadside — `warning`. Present, but not moving. */
  riderStopped: "#F2A93B",
  /** A rider whose last fix has gone stale — `muted`, so it can't read as live. */
  riderStale: "#6B6B72",
  /** An intermediate checkpoint — neutral, so it never competes with the route. */
  checkpoint: "#F2F2EE",
  /** The leader's rally point — `warning`, the one beacon everyone converges on. */
  rally: "#F2A93B",
  /** Glyph colour for the light-on-lime markers. */
  onAccent: "#0A0A0F",
} as const;

// ─── rider status ─────────────────────────────────────────────────────────────

/**
 * What a rider's dot means right now. "stopped" is the state the old UI could
 * not express and the one a group cares about most after "behind": a fresh fix
 * that is not moving is someone at a petrol station, a red light — or the side
 * of the road.
 */
export type RiderStatus = "moving" | "stopped" | "stale" | "offline";

/** ~5 km/h. Below this a motorcycle is not making progress. */
export const STOPPED_SPEED_MS = 1.4;

export function riderStatus(
  pos: { speed: number | null; t: number } | null | undefined,
  now = Date.now(),
): RiderStatus {
  if (!pos) return "offline";
  if (isPositionStale(pos.t, now)) return "stale";
  if (pos.speed != null && pos.speed >= 0 && pos.speed < STOPPED_SPEED_MS) return "stopped";
  return "moving";
}

export function riderInk(status: RiderStatus): string {
  if (status === "moving") return MARKER_INK.riderLive;
  if (status === "stopped") return MARKER_INK.riderStopped;
  return MARKER_INK.riderStale;
}

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

export interface FramePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Frames `items` with pixel insets, falling back to a computed region.
 *
 * The padding may be asymmetric, which matters on the full-screen map: a
 * uniform inset centres the route under a bottom sheet that covers a third of
 * the screen, so the half of the group you most need to see ends up behind it.
 */
export function frameItems(
  mk: MapKitNS,
  map: MapKitMap,
  items: unknown[],
  points: readonly LatLng[],
  opts: { padding: number | FramePadding; animate: boolean },
): void {
  const box = regionForPoints(points);
  if (!box) return;
  const minimumSpan = new mk.CoordinateSpan(
    MIN_SPAN_LAT_DEG,
    minLngSpanDeg(box.centerLat),
  );
  if (typeof map.showItems === "function" && items.length > 0) {
    const p = opts.padding;
    const inset: FramePadding =
      typeof p === "number" ? { top: p, right: p, bottom: p, left: p } : p;
    map.showItems(items, {
      animate: opts.animate,
      minimumSpan,
      padding: mk.Padding ? new mk.Padding(inset) : undefined,
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
