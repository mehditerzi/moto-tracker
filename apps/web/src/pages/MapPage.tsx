import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Crosshair,
  LogOut,
  MapPin,
  Plus,
  Route as RouteIcon,
  Share2,
  Trash2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import {
  MAX_SHARED_ROUTE_CHARS,
  MAX_STOPS,
  type CheckpointKind,
  type RidePlace,
} from "@mototracker/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useMe } from "@/hooks/useMe";
import {
  useActiveRide,
  useCreateRide,
  useJoinRide,
  useLeaveRide,
  useRideChannel,
  type RideStats,
} from "@/hooks/useRide";
import { useRoutePlan } from "@/hooks/useRoutePlan";
import { useSelfPosition } from "@/hooks/useSelfPosition";
import { useKeepAwake } from "@/hooks/useKeepAwake";
import { buildRoster, nextCheckpoint, useDecodedRoute } from "@/hooks/useRideRoster";
import { MapSurface, type MapState } from "@/components/ride/MapSurface";
import { PlaceSearch, type PickedPlace } from "@/components/ride/PlaceSearch";
import { RideSheet } from "@/components/ride/RideSheet";
import { RiderList, formatKm } from "@/components/ride/RiderList";
import { RideSummary } from "@/components/ride/RideSummary";
import { StopList } from "@/components/ride/StopList";
import { CHECKPOINT_KIND_ORDER, CHECKPOINT_META } from "@/components/ride/checkpointMeta";
import {
  baseMapOptions,
  colorSchemeValue,
  frameItems,
  loadMapKit,
  MARKER_INK,
  prefersDarkScheme,
  reverseLookupName,
  riderInk,
  ROUTE_WEIGHT,
  routeStrokeStyles,
  routeThrough,
  watchColorScheme,
  type FramePadding,
  type MapKitMap,
  type MapKitNS,
  type MapKitSearchResult,
} from "@/lib/mapkit";
import { encodeWithinBudget, type LatLng } from "@/lib/polyline";
import { cumulativeKm, type GeoPoint } from "@/lib/geo";
import { pushToast } from "@/hooks/useToast";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { friendlyError } from "@/lib/apiError";
import { track } from "@/lib/telemetry";

/**
 * The ride screen: one full-screen map with everything else floating over it.
 *
 * The old screen was two boxed maps behind a tab switcher, each about a third
 * of a phone. A rider does not consult a map, they *ride from* one — so the map
 * is the page now, and the route plan, the group and the controls are overlays
 * sized for a gloved thumb at a red light.
 */

/**
 * Height of the tab bar plus the home indicator. The sheet clears it rather
 * than sitting under it: the tab bar is the way off this screen.
 */
const TAB_BAR_CLEARANCE = "calc(78px + max(12px, env(safe-area-inset-bottom, 0px)))";

/**
 * Insets used when auto-framing. Asymmetric on purpose — a uniform inset puts
 * the middle of the route behind the sheet, which is where the riders you most
 * need to see happen to be.
 */
const FRAME_INSET: FramePadding = { top: 108, right: 44, bottom: 232, left: 44 };

/** Re-render cadence for freshness ("3 min ago") while no roster arrives. */
const STALENESS_TICK_MS = 10_000;

export function MapPage() {
  const { t } = useTranslation();
  const cfg = usePublicConfig();

  if (cfg.data && !cfg.data.mapkit) {
    return (
      <div className="flex h-full items-center justify-center px-8 pb-32 text-center">
        <p className="text-[15px] text-muted dark:text-muted-dark">{t("map.unavailable")}</p>
      </div>
    );
  }
  return <RideScreen />;
}

interface MapCtx {
  mk: MapKitNS;
  map: MapKitMap;
  routeOverlays: unknown[];
  stopPins: unknown[];
  riderPins: Map<string, unknown>;
  rallyPin: unknown | null;
}

type Mode = "idle" | "search" | "target";

interface DisplayRoute {
  line: LatLng[];
  stops: RidePlace[];
  km: number;
  minutes: number;
  /** True when this is the leader's route arriving over the wire, not our plan. */
  shared: boolean;
}

function RideScreen() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const selfId = me.data?.user.id ?? null;

  const rideQuery = useActiveRide();
  const ride = rideQuery.data ?? null;
  const create = useCreateRide();
  const join = useJoinRide();
  const leave = useLeaveRide();
  const channel = useRideChannel(ride?.id ?? null, {
    title: t("brand"),
    message: t("map.backgroundSharing"),
  });
  const inRide = !!ride && !channel.ended;
  const isLeader = !!ride?.isOwner;

  // The one screen where the phone must not sleep mid-corner.
  useKeepAwake(inRide);

  const plan = useRoutePlan();
  const stops = plan.stops;

  // During a ride our own position already arrives on the roster; running a
  // second GPS client for it would cost battery for nothing.
  const rosterSelf = channel.live.find((m) => m.userId === selfId)?.pos ?? null;
  const watched = useSelfPosition(!inRide || !rosterSelf);
  const selfPos: GeoPoint | null = rosterSelf
    ? { lat: rosterSelf.lat, lng: rosterSelf.lng }
    : watched;
  const selfRef = useRef<GeoPoint | null>(null);
  selfRef.current = selfPos;

  const mapEl = useRef<HTMLDivElement>(null);
  const ctx = useRef<MapCtx | null>(null);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>("idle");
  const [sheetOpen, setSheetOpen] = useState(true);
  const [tab, setTab] = useState<"route" | "group">("route");
  const [summary, setSummary] = useState<RideStats | null>(null);
  const [code, setCode] = useState("");
  const [recalc, setRecalc] = useState(0);
  const [refit, setRefit] = useState(0);
  const [adding, setAdding] = useState(false);

  // Auto-framing yields the moment the rider takes hold of the map.
  const userMoved = useRef(false);
  const framing = useRef(false);
  const lastFit = useRef(0);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), STALENESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ── map lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setMapState("loading");
    loadMapKit()
      .then((mk) => {
        if (cancelled || !mapEl.current) return;
        const map = new mk.Map(mapEl.current, {
          // Full-detail basemap: planning a route needs POIs and road labels.
          ...baseMapOptions(mk, prefersDarkScheme(), false),
          showsUserLocation: true,
          tracksUserLocation: false,
        });
        const claim = () => {
          if (!framing.current) userMoved.current = true;
        };
        map.addEventListener?.("scroll-start", claim);
        map.addEventListener?.("zoom-start", claim);
        ctx.current = { mk, map, routeOverlays: [], stopPins: [], riderPins: new Map(), rallyPin: null };
        setMapState("ready");
        navigator.geolocation?.getCurrentPosition((p) => {
          if (cancelled || userMoved.current) return;
          // Our own region change must not be mistaken for the rider grabbing
          // the map, or auto-framing would switch itself off on first load.
          framing.current = true;
          map.setRegionAnimated(
            new mk.CoordinateRegion(
              new mk.Coordinate(p.coords.latitude, p.coords.longitude),
              new mk.CoordinateSpan(0.06, 0.06),
            ),
            false,
          );
          setTimeout(() => {
            framing.current = false;
          }, 0);
        });
      })
      .catch(() => {
        if (!cancelled) setMapState("failed");
      });
    return () => {
      cancelled = true;
      ctx.current?.map.destroy();
      ctx.current = null;
      userMoved.current = false;
      lastFit.current = 0;
    };
  }, [attempt]);

  useEffect(
    () =>
      watchColorScheme((scheme) => {
        const c = ctx.current;
        if (c) c.map.colorScheme = colorSchemeValue(c.mk, scheme === "dark");
      }),
    [],
  );

  // ── route planning ─────────────────────────────────────────────────────────
  const [planned, setPlanned] = useState<{ line: LatLng[]; km: number; minutes: number } | null>(
    null,
  );
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<null | "location" | "route">(null);

  // Identity of the plan, so a rename or a reorder recomputes but a re-render
  // does not. The origin is *not* in here: re-routing on every GPS fix would
  // burn the Directions quota and redraw the line under the rider's thumb.
  const stopsKey = stops.map((s) => `${s.id}@${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
  const hasOrigin = !!selfPos;

  useEffect(() => {
    const c = ctx.current;
    if (!c || mapState !== "ready") return;
    if (stops.length === 0) {
      setPlanned(null);
      setPlanError(null);
      return;
    }
    const origin = selfRef.current;
    if (!origin) {
      setPlanError("location");
      return;
    }
    let cancelled = false;
    setPlanning(true);
    setPlanError(null);
    const waypoints: LatLng[] = [
      [origin.lat, origin.lng],
      ...stops.map((s): LatLng => [s.lat, s.lng]),
    ];
    routeThrough(c.mk, waypoints)
      .then((legs) => {
        if (cancelled) return;
        const line = legs.flatMap((l) => l.points);
        const km = legs.reduce((n, l) => n + l.km, 0);
        const minutes = legs.reduce((n, l) => n + l.minutes, 0);
        setPlanned({ line, km, minutes });
        track("route_planned", { stops: stops.length, km: Math.round(km) });
      })
      .catch(() => {
        if (!cancelled) setPlanError("route");
      })
      .finally(() => {
        if (!cancelled) setPlanning(false);
      });
    return () => {
      cancelled = true;
    };
    // stopsKey stands in for `stops`; see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, mapState, hasOrigin, recalc]);

  // ── what is on screen: our plan, or the leader's shared route ──────────────
  const followerRoute = inRide && !isLeader ? channel.route : null;
  const decodedShared = useDecodedRoute(followerRoute?.line ?? null);

  const display = useMemo<DisplayRoute | null>(() => {
    if (followerRoute && decodedShared) {
      return {
        line: decodedShared.path.map((p): LatLng => [p.lat, p.lng]),
        stops: followerRoute.stops,
        km: followerRoute.distanceKm,
        minutes: followerRoute.durationMin,
        shared: true,
      };
    }
    if (planned) {
      return { line: planned.line, stops, km: planned.km, minutes: planned.minutes, shared: false };
    }
    return null;
  }, [followerRoute, decodedShared, planned, stops]);

  const routeGeo = useMemo(() => {
    if (!display || display.line.length < 2) return null;
    const path = display.line.map(([lat, lng]) => ({ lat, lng }));
    return { path, cum: cumulativeKm(path) };
  }, [display]);

  const riders = useMemo(
    () =>
      buildRoster({
        members: channel.live,
        selfUserId: selfId,
        ownerId: ride?.ownerId ?? null,
        path: routeGeo?.path,
        cum: routeGeo?.cum,
        now: Date.now(),
      }),
    // `tick` is what re-evaluates staleness while the roster itself is quiet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel.live, selfId, ride?.ownerId, routeGeo, tick],
  );

  const upNext = useMemo(
    () => nextCheckpoint(display?.stops ?? [], selfPos, routeGeo?.path, routeGeo?.cum),
    [display?.stops, selfPos, routeGeo],
  );

  // ── drawing: route + checkpoints ───────────────────────────────────────────
  useEffect(() => {
    const c = ctx.current;
    if (!c || mapState !== "ready") return;
    for (const o of c.routeOverlays) c.map.removeOverlay(o);
    c.routeOverlays = [];
    for (const p of c.stopPins) c.map.removeAnnotation(p);
    c.stopPins = [];
    if (!display) return;

    if (display.line.length >= 2) {
      // Casing under a lime core: the line has to own its own edge over a park,
      // a motorway shield or a dense block of labels.
      const styles = routeStrokeStyles(c.mk, ROUTE_WEIGHT.planner);
      const coords = display.line.map(([lat, lng]) => new c.mk.Coordinate(lat, lng));
      const casing = new c.mk.PolylineOverlay(coords, { style: styles.casing });
      const core = new c.mk.PolylineOverlay(coords, { style: styles.core });
      c.map.addOverlay(casing); // insertion order = paint order
      c.map.addOverlay(core);
      c.routeOverlays.push(casing, core);
    }

    display.stops.forEach((s, i) => {
      const last = i === display.stops.length - 1;
      const kind = t(CHECKPOINT_META[s.kind].labelKey);
      const pin = new c.mk.MarkerAnnotation(new c.mk.Coordinate(s.lat, s.lng), {
        color: last ? MARKER_INK.finish : MARKER_INK.checkpoint,
        glyphColor: MARKER_INK.onAccent,
        // The number is the one label that means the same thing in both
        // languages and matches the list in the sheet exactly.
        glyphText: String(i + 1),
        title: s.name,
        subtitle: kind,
        accessibilityLabel: `${i + 1}. ${s.name} — ${kind}`,
        animates: false,
      });
      c.map.addAnnotation(pin);
      c.stopPins.push(pin);
    });
  }, [display, mapState, t]);

  // ── drawing: riders ────────────────────────────────────────────────────────
  useEffect(() => {
    const c = ctx.current;
    if (!c || mapState !== "ready") return;
    const seen = new Set<string>();
    for (const r of riders) {
      if (!r.pos) continue;
      seen.add(r.userId);
      const existing = c.riderPins.get(r.userId);
      if (existing) c.map.removeAnnotation(existing);
      const faded = r.status === "stale" || r.status === "offline";
      const status = riderCallout(r.status, r.ageMin, r.gapKm, t);
      const pin = new c.mk.MarkerAnnotation(new c.mk.Coordinate(r.pos.lat, r.pos.lng), {
        title: r.isLeader ? `${r.name} · ${t("map.leader")}` : r.name,
        subtitle: r.isSweep ? `${t("map.sweep")} · ${status}` : status,
        color: riderInk(r.status),
        glyphColor: faded ? "#F2F2EE" : MARKER_INK.onAccent,
        // Locale-aware: Turkish "i" upper-cases to "İ", not "I".
        glyphText: r.name.slice(0, 1).toLocaleUpperCase(i18n.language),
        accessibilityLabel: `${r.name} — ${status}`,
        // The leader and the sweep are the two pins that must never be the ones
        // MapKit decides to hide when the group bunches up.
        displayPriority: r.isLeader ? 1000 : r.isSweep ? 900 : faded ? 250 : 700,
        animates: false,
      });
      c.riderPins.set(r.userId, pin);
      c.map.addAnnotation(pin);
    }
    for (const [userId, pin] of c.riderPins) {
      if (!seen.has(userId)) {
        c.map.removeAnnotation(pin);
        c.riderPins.delete(userId);
      }
    }
  }, [riders, mapState, t, i18n.language]);

  // ── drawing: rally point ───────────────────────────────────────────────────
  useEffect(() => {
    const c = ctx.current;
    if (!c || mapState !== "ready") return;
    if (c.rallyPin) {
      c.map.removeAnnotation(c.rallyPin);
      c.rallyPin = null;
    }
    const rally = channel.rally;
    if (!rally) return;
    const pin = new c.mk.MarkerAnnotation(new c.mk.Coordinate(rally.lat, rally.lng), {
      color: MARKER_INK.rally,
      glyphColor: MARKER_INK.onAccent,
      glyphText: "★",
      title: t("map.rallyPoint"),
      subtitle: rally.name ?? t("map.rallyHere"),
      accessibilityLabel: t("map.rallyPoint"),
      displayPriority: 1000,
    });
    c.map.addAnnotation(pin);
    c.rallyPin = pin;
  }, [channel.rally, mapState, t]);

  // A rally point is an instruction, not a notification: it gets a haptic the
  // rider can feel through a glove without looking at the screen.
  const lastRally = useRef(0);
  useEffect(() => {
    const rally = channel.rally;
    if (!rally || rally.at === lastRally.current) return;
    lastRally.current = rally.at;
    if (isLeader) return;
    hapticWarning();
    pushToast({ title: t("map.rallyAnnounced") });
  }, [channel.rally, isLeader, t]);

  // ── framing ────────────────────────────────────────────────────────────────
  // `refit` is a counter, not a flag: comparing it against the last value this
  // effect handled is what distinguishes "the rider asked to be re-framed" from
  // "the roster ticked again", so one recentre does not disable auto-framing
  // for the rest of the ride.
  const handledRefit = useRef(0);
  useEffect(() => {
    const c = ctx.current;
    if (!c || mapState !== "ready") return;
    const forced = refit !== handledRefit.current;
    handledRefit.current = refit;
    if (userMoved.current && !forced) return;
    const points: LatLng[] = [];
    if (display) points.push(...display.line);
    for (const r of riders) if (r.pos) points.push([r.pos.lat, r.pos.lng]);
    if (points.length === 0) return;
    const first = lastFit.current === 0;
    // The roster ticks every few seconds; a map that re-fits that often is
    // unusable, so a fit costs at least five seconds unless it was asked for.
    if (!first && !forced && Date.now() - lastFit.current < 5000) return;
    lastFit.current = Date.now();
    framing.current = true;
    frameItems(
      c.mk,
      c.map,
      [...c.routeOverlays, ...c.stopPins, ...c.riderPins.values()],
      points,
      { padding: FRAME_INSET, animate: !first },
    );
    setTimeout(() => {
      framing.current = false;
    }, 0);
  }, [display, riders, mapState, refit]);

  // ── actions ────────────────────────────────────────────────────────────────
  const searchPlaces = useCallback((query: string): Promise<MapKitSearchResult[]> => {
    const c = ctx.current;
    if (!c) return Promise.reject(new Error("map_not_ready"));
    return new Promise((resolve, reject) => {
      // Biased to what is on screen: "benzinlik" should mean the one up the
      // road, not the one in another city.
      new c.mk.Search({ language: navigator.language, region: c.map.region }).search(
        query,
        (err, data) => {
          if (err) reject(err instanceof Error ? err : new Error("search_failed"));
          else resolve(data.places.slice(0, 8));
        },
      );
    });
  }, []);

  function addStop(place: PickedPlace) {
    if (stops.length >= MAX_STOPS) {
      pushToast({ variant: "danger", title: t("map.tooManyStops", { count: MAX_STOPS }) });
      return;
    }
    plan.addStop(place);
    hapticSuccess();
    setMode("idle");
    setSheetOpen(true);
    setTab("route");
    // A new stop is a new plan; re-frame it even if the map was panned earlier.
    userMoved.current = false;
    setRefit((n) => n + 1);
  }

  /** "Add a stop where the crosshair is" — two taps, no typing, no long-press. */
  async function addStopAtCenter(kind: CheckpointKind) {
    const c = ctx.current;
    const center = c?.map.center;
    if (!c || !center) return;
    setAdding(true);
    const point: LatLng = [center.latitude, center.longitude];
    const name = await reverseLookupName(c.mk, point);
    setAdding(false);
    addStop({
      name: name ?? t(CHECKPOINT_META[kind].labelKey),
      lat: point[0],
      lng: point[1],
      kind,
    });
  }

  function recentre() {
    const c = ctx.current;
    if (!c) return;
    userMoved.current = false;
    lastFit.current = 0;
    if (riders.some((r) => r.pos) || display) {
      setRefit((n) => n + 1);
      return;
    }
    const self = selfRef.current;
    if (!self) {
      pushToast({ variant: "danger", title: t("map.locationNeeded") });
      return;
    }
    framing.current = true;
    c.map.setRegionAnimated(
      new c.mk.CoordinateRegion(
        new c.mk.Coordinate(self.lat, self.lng),
        new c.mk.CoordinateSpan(0.04, 0.04),
      ),
      true,
    );
    setTimeout(() => {
      framing.current = false;
    }, 0);
  }

  function shareRouteWithGroup() {
    if (!display || display.shared) return;
    const line = encodeWithinBudget(display.line, MAX_SHARED_ROUTE_CHARS);
    const ok = channel.shareRoute({
      line,
      stops: display.stops,
      distanceKm: Math.round(display.km * 10) / 10,
      durationMin: Math.round(display.minutes),
    });
    if (ok) {
      hapticSuccess();
      pushToast({ variant: "success", title: t("map.routeShared") });
      track("ride_route_shared", { stops: display.stops.length });
    } else {
      pushToast({ variant: "danger", title: t("map.notConnected") });
    }
  }

  function toggleRally() {
    if (channel.rally) {
      channel.setRally(null);
      pushToast({ title: t("map.rallyCleared") });
      return;
    }
    const self = selfRef.current;
    if (!self) {
      pushToast({ variant: "danger", title: t("map.locationNeeded") });
      return;
    }
    const ok = channel.setRally({ lat: self.lat, lng: self.lng, name: t("map.rallyHere") });
    if (ok) {
      hapticSuccess();
      pushToast({ variant: "success", title: t("map.rallySent") });
      track("ride_rally_set");
    } else {
      pushToast({ variant: "danger", title: t("map.notConnected") });
    }
  }

  async function shareCode() {
    if (!ride) return;
    const text = t("map.shareText", { code: ride.code });
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(ride.code);
        pushToast({ variant: "success", title: t("map.codeCopied") });
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  function endRide() {
    // Captured before the channel unmounts — the summary is the only thing the
    // ride leaves behind, and it lives in this component's memory alone.
    setSummary(channel.getStats());
    leave.mutate(undefined, {
      onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }),
    });
  }

  // The ride ending underneath us (the leader closed it) is the other way in.
  const { ended: rideEnded, getStats } = channel;
  useEffect(() => {
    if (rideEnded && !summary) setSummary(getStats());
  }, [rideEnded, summary, getStats]);

  // ── render ─────────────────────────────────────────────────────────────────
  const riderCount = riders.length;
  const sweep = riders.find((r) => r.isSweep) ?? null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-elev dark:bg-surface-elev-dark">
      <MapSurface
        innerRef={mapEl}
        state={mapState}
        onRetry={() => setAttempt((n) => n + 1)}
        label={
          display
            ? t("map.routeAlt", {
                name: display.stops[display.stops.length - 1]?.name ?? "",
                km: Math.round(display.km),
                eta: formatDuration(display.minutes, t),
              })
            : t("map.mapAlt")
        }
      />

      {/* ── top chrome ─────────────────────────────────────────────────────── */}
      {mode !== "target" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 px-3 pt-safe">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("search")}
              className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl bg-surface/97 px-4 text-left shadow-card ring-1 ring-border backdrop-blur-xl dark:bg-surface-dark/97 dark:shadow-card-dark dark:ring-border-dark"
            >
              <Plus className="h-6 w-6 shrink-0 text-accent-dim dark:text-accent" strokeWidth={2.2} />
              <span className="truncate text-[16px] font-medium">{t("map.addStop")}</span>
            </button>
            {ride && (
              <button
                type="button"
                onClick={() => void shareCode()}
                aria-label={t("map.shareCode")}
                className="flex h-14 shrink-0 items-center gap-2 rounded-2xl bg-surface/97 px-4 shadow-card ring-1 ring-border backdrop-blur-xl dark:bg-surface-dark/97 dark:shadow-card-dark dark:ring-border-dark"
              >
                <span className="num text-[18px] font-semibold tracking-[0.14em]">{ride.code}</span>
                <Copy className="h-4 w-4 text-muted dark:text-muted-dark" />
              </button>
            )}
          </div>

          {inRide && !channel.connected && (
            <div
              role="status"
              className="pointer-events-auto flex items-center gap-2 self-start rounded-xl bg-warning/15 px-3 py-2 text-[13px] font-medium text-warning ring-1 ring-warning/40 backdrop-blur"
            >
              <WifiOff className="h-4 w-4" strokeWidth={2} />
              {t("map.reconnecting")}
            </div>
          )}

          {inRide && upNext && (
            <div className="pointer-events-auto flex items-center gap-2 self-start rounded-xl bg-surface/97 px-3 py-2 text-[13px] ring-1 ring-border backdrop-blur-xl dark:bg-surface-dark/97 dark:ring-border-dark">
              <RouteIcon className="h-4 w-4 text-accent-dim dark:text-accent" strokeWidth={2} />
              <span className="font-medium">{t("map.upNext")}</span>
              <span className="truncate">{upNext.place.name}</span>
              <span className="num text-muted dark:text-muted-dark">{formatKm(upNext.km)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── right rail ─────────────────────────────────────────────────────── */}
      {mode === "idle" && (
        <div
          className="absolute right-3 z-10 flex flex-col gap-2"
          style={{ bottom: `calc(${TAB_BAR_CLEARANCE} + 80px)` }}
        >
          <RailButton label={t("map.dropHere")} onClick={() => setMode("target")}>
            <MapPin className="h-7 w-7" strokeWidth={2} />
          </RailButton>
          <RailButton label={t("map.recentre")} onClick={recentre}>
            <Crosshair className="h-7 w-7" strokeWidth={2} />
          </RailButton>
        </div>
      )}

      {/* ── drop-a-pin targeting ───────────────────────────────────────────── */}
      {mode === "target" && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="h-16 w-16 rounded-full border-[3px] border-accent shadow-ignite" />
            <div className="absolute h-2 w-2 rounded-full bg-accent" />
          </div>
          <div
            className="absolute inset-x-0 z-20 px-3"
            style={{ bottom: TAB_BAR_CLEARANCE }}
          >
            <div className="mx-auto w-full max-w-2xl rounded-2xl bg-surface/97 p-3 shadow-card ring-1 ring-border backdrop-blur-xl dark:bg-surface-dark/97 dark:ring-border-dark">
              <div className="flex items-center justify-between gap-2 pb-2">
                <p className="text-[15px] font-medium">{t("map.dropHelp")}</p>
                <button
                  type="button"
                  onClick={() => setMode("idle")}
                  aria-label={t("common.cancel")}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-muted dark:text-muted-dark"
                >
                  <X className="h-6 w-6" strokeWidth={2} />
                </button>
              </div>
              {/* One tap per kind: choosing the kind *is* the confirmation. */}
              <div className="grid grid-cols-5 gap-1.5">
                {CHECKPOINT_KIND_ORDER.map((k) => {
                  const Icon = CHECKPOINT_META[k].icon;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={adding}
                      onClick={() => void addStopAtCenter(k)}
                      className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-xl bg-surface-elev text-[12px] font-medium ring-1 ring-border transition active:scale-[0.97] disabled:opacity-50 dark:bg-surface-elev-dark dark:ring-border-dark"
                    >
                      <Icon className="h-6 w-6 text-accent-dim dark:text-accent" strokeWidth={1.9} />
                      {t(CHECKPOINT_META[k].labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── the sheet ──────────────────────────────────────────────────────── */}
      {mode === "idle" && (
        <RideSheet
          open={sheetOpen}
          onToggle={() => setSheetOpen((v) => !v)}
          bottomOffset={TAB_BAR_CLEARANCE}
          summary={
            <SheetSummary
              inRide={inRide}
              riderCount={riderCount}
              sweepGapKm={sweep?.gapKm ?? null}
              display={display}
              planning={planning}
            />
          }
        >
          {inRide && (
            <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark">
              {(["route", "group"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  aria-pressed={tab === k}
                  className={`min-h-[44px] rounded-xl text-[14px] font-medium transition ${
                    tab === k
                      ? "bg-surface text-text shadow-card dark:bg-surface-dark dark:text-text-dark"
                      : "text-muted dark:text-muted-dark"
                  }`}
                >
                  {t(k === "route" ? "map.route" : "map.together")}
                </button>
              ))}
            </div>
          )}

          {(!inRide || tab === "route") && (
            <RoutePanel
              stops={stops}
              display={display}
              planning={planning}
              planError={planError}
              canShare={inRide && isLeader && !!display && !display.shared}
              shared={!!display?.shared}
              onShare={shareRouteWithGroup}
              onRecalc={() => setRecalc((n) => n + 1)}
              onClear={() => {
                plan.clear();
                setPlanned(null);
              }}
              onMove={plan.moveStop}
              onRemove={plan.removeStop}
              onKind={plan.setKind}
              onAdd={() => setMode("search")}
            />
          )}

          {inRide && tab === "group" && (
            <div className="flex flex-col gap-3">
              <RiderList riders={riders} />
              <div className="flex flex-col gap-2">
                {isLeader && (
                  <Button
                    variant={channel.rally ? "outline" : "accent"}
                    size="lg"
                    className="h-14 w-full"
                    onClick={toggleRally}
                  >
                    <Users className="h-5 w-5" />
                    {channel.rally ? t("map.rallyClear") : t("map.rallyAction")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="lg"
                  className="h-14 w-full"
                  onClick={endRide}
                  disabled={leave.isPending}
                >
                  <LogOut className="h-5 w-5" />
                  {isLeader ? t("map.endRide") : t("map.leaveRide")}
                </Button>
              </div>
            </div>
          )}

          {!inRide && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 dark:border-border-dark">
              <p className="text-[13px] leading-relaxed text-muted dark:text-muted-dark">
                {t("map.togetherIntro")}
              </p>
              <Button
                variant="accent"
                size="lg"
                className="h-14 w-full"
                disabled={create.isPending}
                onClick={() =>
                  create.mutate(undefined, {
                    onSuccess: () => {
                      setSummary(null);
                      setTab("group");
                      hapticSuccess();
                      track("ride_created");
                    },
                    onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }),
                  })
                }
              >
                <Users className="h-5 w-5" /> {t("map.startRide")}
              </Button>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={t("map.codePlaceholder")}
                  className="num h-14 text-center text-[18px] uppercase tracking-[0.2em]"
                  maxLength={8}
                  aria-label={t("map.codePlaceholder")}
                />
                <Button
                  variant="default"
                  size="lg"
                  className="h-14 px-6"
                  disabled={join.isPending || code.trim().length < 4}
                  onClick={() =>
                    join.mutate(code.trim(), {
                      onSuccess: () => {
                        setSummary(null);
                        setCode("");
                        setTab("group");
                        hapticSuccess();
                        track("ride_joined");
                      },
                      onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }),
                    })
                  }
                >
                  {t("map.join")}
                </Button>
              </div>
            </div>
          )}
        </RideSheet>
      )}

      <PlaceSearch
        open={mode === "search"}
        recents={plan.recents}
        onSearch={searchPlaces}
        onPick={addStop}
        onClose={() => setMode("idle")}
      />

      {summary && <RideSummary stats={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}

// ─── sheet contents ───────────────────────────────────────────────────────────

function SheetSummary({
  inRide,
  riderCount,
  sweepGapKm,
  display,
  planning,
}: {
  inRide: boolean;
  riderCount: number;
  sweepGapKm: number | null;
  display: DisplayRoute | null;
  planning: boolean;
}) {
  const { t } = useTranslation();
  if (inRide) {
    return (
      <>
        <span className="block text-[16px] font-semibold leading-tight">
          {t("map.riders", { count: riderCount })}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted dark:text-muted-dark">
          {sweepGapKm != null
            ? t("map.sweepBehind", { km: formatKm(sweepGapKm) })
            : t("map.groupTogether")}
        </span>
      </>
    );
  }
  if (planning) {
    return <span className="block text-[16px] font-medium">{t("map.planning")}</span>;
  }
  if (display) {
    return (
      <>
        <span className="block text-[16px] font-semibold leading-tight">
          <span className="num">{display.km < 10 ? display.km.toFixed(1) : Math.round(display.km)} km</span>
          {" · "}
          {formatDuration(display.minutes, t)}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted dark:text-muted-dark">
          {t("map.stopsCount", { count: display.stops.length })}
        </span>
      </>
    );
  }
  return <span className="block text-[16px] font-medium">{t("map.planPrompt")}</span>;
}

function RoutePanel({
  stops,
  display,
  planning,
  planError,
  canShare,
  shared,
  onShare,
  onRecalc,
  onClear,
  onMove,
  onRemove,
  onKind,
  onAdd,
}: {
  stops: RidePlace[];
  display: DisplayRoute | null;
  planning: boolean;
  planError: null | "location" | "route";
  canShare: boolean;
  shared: boolean;
  onShare: () => void;
  onRecalc: () => void;
  onClear: () => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onKind: (id: string, kind: CheckpointKind) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();

  // A follower is looking at the leader's route: it is not theirs to edit, and
  // pretending otherwise would let them silently diverge from the group.
  if (shared && display) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-muted dark:text-muted-dark">{t("map.sharedRouteNote")}</p>
        <ol className="flex flex-col gap-1.5">
          {display.stops.map((s, i) => {
            const Icon = CHECKPOINT_META[s.kind].icon;
            return (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
              >
                <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-elev text-[15px] font-semibold dark:bg-surface-dark">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{s.name}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[13px] text-muted dark:text-muted-dark">
                    <Icon className="h-4 w-4" strokeWidth={1.9} />
                    {t(CHECKPOINT_META[s.kind].labelKey)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {stops.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-muted dark:text-muted-dark">
          {t("map.planEmpty")}
        </p>
      ) : (
        <StopList stops={stops} onMove={onMove} onRemove={onRemove} onKind={onKind} />
      )}

      {planError && (
        <p role="alert" className="text-[13px] text-danger">
          {planError === "location" ? t("map.locationNeeded") : t("map.routeFailed")}
        </p>
      )}
      {planning && (
        <p role="status" className="text-[13px] text-muted dark:text-muted-dark">
          {t("map.planning")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button variant="accent" size="lg" className="h-14 w-full" onClick={onAdd}>
          <Plus className="h-5 w-5" /> {t("map.addStop")}
        </Button>
        {canShare && (
          <Button variant="default" size="lg" className="h-14 w-full" onClick={onShare}>
            <Share2 className="h-5 w-5" /> {t("map.shareRoute")}
          </Button>
        )}
        {stops.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="lg" className="h-12 flex-1" onClick={onRecalc}>
              <RouteIcon className="h-5 w-5" /> {t("map.recalc")}
            </Button>
            <Button variant="outline" size="lg" className="h-12 flex-1" onClick={onClear}>
              <Trash2 className="h-5 w-5" /> {t("map.clearRoute")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RailButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface/97 text-text shadow-card ring-1 ring-border backdrop-blur-xl transition active:scale-95 dark:bg-surface-dark/97 dark:text-text-dark dark:shadow-card-dark dark:ring-border-dark"
    >
      {children}
    </button>
  );
}

// ─── formatting ───────────────────────────────────────────────────────────────

function formatDuration(
  minutes: number,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? t("map.durationHm", { h, m }) : t("map.durationM", { m });
}

/** The marker callout's second line — the same words the list uses. */
function riderCallout(
  status: string,
  ageMin: number,
  gapKm: number | null,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (status === "offline") return t("map.noFix");
  if (status === "stale") {
    return ageMin < 1 ? t("map.lastSeenRecent") : t("map.lastSeen", { count: ageMin });
  }
  const base = status === "stopped" ? t("map.stopped") : t("map.live");
  if (gapKm == null || gapKm < 0.1) return base;
  return `${base} · ${formatKm(gapKm)} ${t("map.behindShort")}`;
}
