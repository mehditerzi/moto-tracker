import { api } from "./api";

/**
 * Lazy MapKit JS loader. The script is injected only when a map is actually
 * shown, and authorization tokens are minted server-side by /api/mapkit-token
 * (the signing key never reaches the client). MapKit re-invokes the callback
 * itself when a token nears expiry.
 */

// MapKit JS ships no types — model just the surface we use.
export interface MapKitSearchResult {
  displayLines?: string[];
  coordinate: { latitude: number; longitude: number };
  name?: string;
  formattedAddress?: string;
}
export interface MapKitRoute {
  polyline: unknown;
  distance: number; // meters
  expectedTravelTime: number; // seconds
}
export interface MapKitNS {
  init(opts: { authorizationCallback: (done: (token: string) => void) => void }): void;
  Map: new (el: HTMLElement, opts?: Record<string, unknown>) => MapKitMap;
  Coordinate: new (lat: number, lng: number) => unknown;
  CoordinateRegion: new (center: unknown, span: unknown) => unknown;
  CoordinateSpan: new (latDelta: number, lngDelta: number) => unknown;
  PolylineOverlay: new (coords: unknown[], opts?: Record<string, unknown>) => unknown;
  Style: new (opts: Record<string, unknown>) => unknown;
  MarkerAnnotation: new (coord: unknown, opts?: Record<string, unknown>) => unknown;
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
  addOverlay(o: unknown): void;
  removeOverlay(o: unknown): void;
  addAnnotation(a: unknown): void;
  removeAnnotation(a: unknown): void;
  setRegionAnimated(region: unknown, animated?: boolean): void;
  destroy(): void;
}

declare global {
  interface Window {
    mapkit?: MapKitNS;
  }
}

const SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
let loading: Promise<MapKitNS> | null = null;

export function loadMapKit(): Promise<MapKitNS> {
  if (!loading) {
    loading = new Promise<MapKitNS>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SRC;
      script.crossOrigin = "anonymous";
      script.onload = () => {
        const mk = window.mapkit;
        if (!mk) {
          reject(new Error("mapkit_load_failed"));
          return;
        }
        mk.init({
          authorizationCallback: (done) => {
            api<{ token: string }>("/api/mapkit-token")
              .then((r) => done(r.token))
              .catch(() => done(""));
          },
        });
        resolve(mk);
      };
      script.onerror = () => {
        loading = null; // allow a retry on the next map open
        reject(new Error("mapkit_load_failed"));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}
