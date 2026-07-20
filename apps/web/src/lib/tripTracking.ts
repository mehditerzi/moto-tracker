import { useSyncExternalStore } from "react";
import { haversineKm } from "./geo";
import { encodePolyline, simplifyToBudget, type LatLng } from "./polyline";

// ─── auto-detection engine ────────────────────────────────────────────────────

export interface Sample {
  lat: number;
  lng: number;
  /** epoch ms */
  t: number;
  /** ground speed in m/s from the GPS, if known (negative/null = unknown) */
  speed?: number | null;
  /** horizontal accuracy in meters, if known */
  accuracy?: number | null;
}

export interface CompletedTrip {
  distanceKm: number;
  startedAt: string;
  endedAt: string;
  pointCount: number;
  /** Encoded polyline of the (simplified) route, null when too few points. */
  route: string | null;
}

// Tunables for "is the vehicle driving?" detection.
const START_SPEED_MS = 3; // ~11 km/h sustained → a drive has begun
const STOP_SPEED_MS = 0.8; // ~3 km/h → effectively stopped
const STOP_AFTER_MS = 180_000; // stationary this long ends the trip (3 min)
const MAX_ACCURACY_M = 100; // drop very fuzzy fixes
const MAX_SEGMENT_SPEED_MS = 80; // ~288 km/h between fixes → GPS glitch, skip it
// Route capture: keep a raw point only every ≥ this far (bounds memory on long
// rides); the kept trace is Douglas-Peucker-simplified again at trip end.
const ROUTE_THIN_M = 30;
const ROUTE_MAX_POINTS = 1000;
const ROUTE_TOLERANCE_M = 20;

/**
 * Stateful, side-effect-free detector. Feed it GPS samples in time order; it
 * decides when a trip starts (sustained movement) and ends (long enough
 * stationary), accumulating distance in between. Returns a CompletedTrip the
 * moment one ends, otherwise null — which makes the whole thing unit-testable
 * without any real geolocation.
 */
export class TripDetector {
  private moving = false;
  private startedAt = 0;
  private lastPoint: Sample | null = null;
  private distanceKm = 0;
  private points = 0;
  private stillSince: number | null = null;
  private route: LatLng[] = [];

  push(s: Sample): CompletedTrip | null {
    if (s.accuracy != null && s.accuracy > MAX_ACCURACY_M) return null;
    const speed = effectiveSpeed(s, this.lastPoint);

    if (!this.moving) {
      if (speed >= START_SPEED_MS) {
        this.moving = true;
        this.startedAt = s.t;
        this.distanceKm = 0;
        this.points = 1;
        this.stillSince = null;
        this.route = [[s.lat, s.lng]];
      }
      this.lastPoint = s;
      return null;
    }

    if (this.lastPoint) {
      const seg = haversineKm(this.lastPoint, s);
      const dtSec = (s.t - this.lastPoint.t) / 1000;
      const segSpeed = dtSec > 0 ? (seg * 1000) / dtSec : 0;
      if (segSpeed <= MAX_SEGMENT_SPEED_MS) this.distanceKm += seg;
    }
    this.points += 1;
    this.lastPoint = s;

    const lastKept = this.route[this.route.length - 1];
    if (!lastKept || haversineKm({ lat: lastKept[0], lng: lastKept[1] }, s) * 1000 >= ROUTE_THIN_M) {
      this.route.push([s.lat, s.lng]);
    }

    if (speed < STOP_SPEED_MS) {
      if (this.stillSince == null) this.stillSince = s.t;
      else if (s.t - this.stillSince >= STOP_AFTER_MS) return this.end(s.t);
    } else {
      this.stillSince = null;
    }
    return null;
  }

  /** Force-end an in-progress trip (e.g. tracking switched off). */
  flush(now: number): CompletedTrip | null {
    return this.moving ? this.end(now) : null;
  }

  private end(endT: number): CompletedTrip {
    const simplified =
      this.route.length >= 2
        ? simplifyToBudget(this.route, ROUTE_MAX_POINTS, ROUTE_TOLERANCE_M)
        : null;
    const trip: CompletedTrip = {
      distanceKm: Math.round(this.distanceKm * 100) / 100,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(endT).toISOString(),
      pointCount: this.points,
      route: simplified && simplified.length >= 2 ? encodePolyline(simplified) : null,
    };
    this.moving = false;
    this.lastPoint = null;
    this.distanceKm = 0;
    this.points = 0;
    this.stillSince = null;
    this.route = [];
    return trip;
  }
}

function effectiveSpeed(s: Sample, prev: Sample | null): number {
  if (s.speed != null && s.speed >= 0) return s.speed;
  if (!prev) return 0;
  const dtSec = (s.t - prev.t) / 1000;
  if (dtSec <= 0) return 0;
  return (haversineKm(prev, s) * 1000) / dtSec;
}

// ─── geolocation runner ───────────────────────────────────────────────────────

export interface TrackerHandle {
  stop: () => void;
}

export interface StartOptions {
  onTrip: (t: CompletedTrip) => void;
  /** iOS background-notification text (required for true background delivery). */
  backgroundTitle?: string;
  backgroundMessage?: string;
}

interface GeoSource {
  stop: () => void;
}

// On native the background plugin only emits while moving, so once the vehicle
// parks the samples stop and the detector's own stop-detection never fires.
// This watchdog ends an in-progress trip after a stretch with no fixes at all.
const NO_SAMPLE_END_MS = 240_000; // 4 min

function isNativePlatform(): boolean {
  const cap =
    typeof window !== "undefined"
      ? (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      : undefined;
  return !!cap?.isNativePlatform?.();
}

function watchWeb(onSample: (s: Sample) => void): GeoSource {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { stop: () => {} };
  const watchId = navigator.geolocation.watchPosition(
    (pos) =>
      onSample({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        t: pos.timestamp,
        speed: pos.coords.speed,
        accuracy: pos.coords.accuracy,
      }),
    () => {
      /* permission denied / unavailable — stay idle, no crash */
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
  return { stop: () => navigator.geolocation.clearWatch(watchId) };
}

function watchNative(
  onSample: (s: Sample) => void,
  onError: (e: unknown) => void,
  opts: Pick<StartOptions, "backgroundTitle" | "backgroundMessage">,
): GeoSource {
  let stopped = false;
  let stopFn: (() => void) | null = null;
  // Loaded lazily so the native plugin never reaches the web bundle / tests.
  void import("./nativeGeo")
    .then((m) =>
      m.startNativeWatch(onSample, onError, {
        backgroundTitle: opts.backgroundTitle ?? "Garajım",
        backgroundMessage: opts.backgroundMessage ?? "",
      }),
    )
    .then((h) => {
      if (stopped) h.stop();
      else stopFn = h.stop;
    })
    .catch((e) => onError(e));
  return {
    stop: () => {
      stopped = true;
      stopFn?.();
    },
  };
}

export interface PositionWatchHandle {
  stop: () => void;
}

/**
 * Generic best-available position watch (not tied to trip detection): the
 * native background-geolocation plugin on device — which keeps the whole app
 * (JS timers, sockets) alive while backgrounded — with the browser Geolocation
 * API as fallback on web or when the native watcher errors (e.g. permission
 * granted "While Using" only). Used by live ride sharing.
 */
export function watchBestPosition(
  onSample: (s: Sample) => void,
  opts: Pick<StartOptions, "backgroundTitle" | "backgroundMessage">,
): PositionWatchHandle {
  if (!isNativePlatform()) return watchWeb(onSample);
  let fallback: GeoSource | null = null;
  const native = watchNative(
    onSample,
    () => {
      // Native watcher unavailable — degrade to the foreground web watch once.
      if (!fallback) fallback = watchWeb(onSample);
    },
    opts,
  );
  return {
    stop: () => {
      native.stop();
      fallback?.stop();
    },
  };
}

/**
 * Drives a TripDetector from the best available location source: the native
 * background-geolocation plugin on device (keeps detecting with the app
 * backgrounded), or the Geolocation API in the PWA / browser (foreground).
 */
export function startTripTracking(opts: StartOptions): TrackerHandle {
  const detector = new TripDetector();
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };
  const armWatchdog = () => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      const trip = detector.flush(Date.now());
      if (trip) opts.onTrip(trip);
    }, NO_SAMPLE_END_MS);
  };

  const onSample = (s: Sample) => {
    const trip = detector.push(s);
    if (trip) {
      clearWatchdog();
      opts.onTrip(trip);
    } else {
      armWatchdog();
    }
  };

  const source = isNativePlatform()
    ? watchNative(onSample, () => {}, opts)
    : watchWeb(onSample);

  return {
    stop: () => {
      clearWatchdog();
      source.stop();
      const trip = detector.flush(Date.now());
      if (trip) opts.onTrip(trip);
    },
  };
}

// ─── enabled flag (persisted, reactive) ───────────────────────────────────────

const KEY = "mototracker.tripTracking";
const listeners = new Set<() => void>();

export function isTripTrackingEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setTripTrackingEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Reactive read of the persisted on/off flag, in sync across components. */
export function useTripTrackingEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isTripTrackingEnabled,
    () => false,
  );
}
