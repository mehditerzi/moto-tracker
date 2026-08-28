import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Copy,
  LogOut,
  MapPin,
  RotateCw,
  Search as SearchIcon,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import {
  useActiveRide,
  useCreateRide,
  useJoinRide,
  useLeaveRide,
  useRideChannel,
  type RideMember,
} from "@/hooks/useRide";
import {
  baseMapOptions,
  casingForPolyline,
  colorSchemeValue,
  frameItems,
  isPositionStale,
  loadMapKit,
  MARKER_INK,
  minutesSince,
  prefersDarkScheme,
  ROUTE_WEIGHT,
  routeStrokeStyles,
  watchColorScheme,
  type MapKitMap,
  type MapKitNS,
  type MapKitPolyline,
  type MapKitSearchResult,
} from "@/lib/mapkit";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { track } from "@/lib/telemetry";

type Tab = "route" | "together";

export function MapPage() {
  const { t } = useTranslation();
  const cfg = usePublicConfig();
  const [tab, setTab] = useState<Tab>("route");

  if (cfg.data && !cfg.data.mapkit) {
    return (
      <p className="py-16 text-center text-muted dark:text-muted-dark">{t("map.unavailable")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("nav.map")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
          {t("map.title")}
        </h1>
      </header>

      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark">
        {(["route", "together"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-xl py-2 text-[13px] font-medium transition ${
              tab === k
                ? "bg-surface shadow-card text-text dark:bg-surface-dark dark:text-text-dark"
                : "text-muted dark:text-muted-dark"
            }`}
          >
            {t(`map.${k}`)}
          </button>
        ))}
      </div>

      {tab === "route" ? <RoutePlanner /> : <GroupRide />}
    </div>
  );
}

// ─── shared map surface ───────────────────────────────────────────────────────

type MapState = "loading" | "ready" | "failed";

/**
 * The chrome every map on this page shares. MapKit can fail for reasons the
 * user can do nothing about (the CDN script blocked, /api/mapkit-token
 * answering 503 because MapKit is unconfigured) — this says so and offers a
 * retry instead of leaving a blank grey rectangle that looks like a bug.
 */
function MapSurface({
  innerRef,
  state,
  onRetry,
  label,
  className,
}: {
  innerRef: RefObject<HTMLDivElement>;
  state: MapState;
  onRetry: () => void;
  label: string;
  className: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`relative overflow-hidden rounded-2xl ring-1 ring-border dark:ring-border-dark ${className}`}
    >
      <div ref={innerRef} role="region" aria-label={label} className="h-full w-full" />
      {state === "loading" && <Skeleton className="absolute inset-0 rounded-2xl" />}
      {state === "failed" && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-elev p-6 text-center dark:bg-surface-elev-dark"
        >
          <AlertTriangle className="h-6 w-6 text-warning" strokeWidth={1.7} />
          <p className="text-[13px] text-muted dark:text-muted-dark">{t("map.mapFailed")}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw className="h-4 w-4" /> {t("common.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── route planner ────────────────────────────────────────────────────────────

function fmtDuration(seconds: number, t: (k: string, o?: Record<string, unknown>) => string) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? t("map.durationHm", { h, m }) : t("map.durationM", { m });
}

interface PlannerCtx {
  mk: MapKitNS;
  map: MapKitMap;
  /** Casing + core, so both come off the map when a new route is planned. */
  overlays: unknown[];
  pin?: unknown;
}

function RoutePlanner() {
  const { t } = useTranslation();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<PlannerCtx | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapKitSearchResult[]>([]);
  const [info, setInfo] = useState<{ km: number; eta: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [attempt, setAttempt] = useState(0);

  // Map boots once, centered on the user.
  useEffect(() => {
    let cancelled = false;
    setMapState("loading");
    loadMapKit()
      .then((mk) => {
        if (cancelled || !mapRef.current) return;
        const map = new mk.Map(mapRef.current, {
          // Full-detail basemap here: picking a destination needs POIs and road
          // labels, unlike the read-only trip preview.
          ...baseMapOptions(mk, prefersDarkScheme(), false),
          showsUserLocation: true,
          tracksUserLocation: false,
        });
        mapObj.current = { mk, map, overlays: [] };
        setMapState("ready");
        navigator.geolocation?.getCurrentPosition((p) => {
          if (cancelled) return;
          map.setRegionAnimated(
            new mk.CoordinateRegion(
              new mk.Coordinate(p.coords.latitude, p.coords.longitude),
              new mk.CoordinateSpan(0.08, 0.08),
            ),
            false,
          );
        });
      })
      .catch(() => {
        if (!cancelled) setMapState("failed");
      });
    return () => {
      cancelled = true;
      mapObj.current?.map.destroy();
      mapObj.current = null;
    };
  }, [attempt]);

  // Follow the OS theme for as long as the map is mounted.
  useEffect(
    () =>
      watchColorScheme((scheme) => {
        const c = mapObj.current;
        if (c) c.map.colorScheme = colorSchemeValue(c.mk, scheme === "dark");
      }),
    [],
  );

  function search() {
    const ctx = mapObj.current;
    if (!ctx || query.trim().length < 2) return;
    new ctx.mk.Search({ language: navigator.language }).search(query, (err, data) => {
      if (err) {
        pushToast({ variant: "danger", title: t("map.searchFailed") });
        return;
      }
      const places = data.places.slice(0, 6);
      if (places.length === 0) pushToast({ title: t("map.searchEmpty") });
      setResults(places);
    });
  }

  function routeTo(place: MapKitSearchResult) {
    const ctx = mapObj.current;
    if (!ctx) return;
    setResults([]);
    setQuery(place.name ?? "");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const origin = new ctx.mk.Coordinate(p.coords.latitude, p.coords.longitude);
        const dest = new ctx.mk.Coordinate(place.coordinate.latitude, place.coordinate.longitude);
        new ctx.mk.Directions().route({ origin, destination: dest }, (err, data) => {
          setBusy(false);
          const route = data?.routes?.[0];
          if (err || !route) {
            pushToast({ variant: "danger", title: t("map.routeFailed") });
            return;
          }
          // Clear the previous plan before drawing the new one.
          for (const o of ctx.overlays) ctx.map.removeOverlay(o);
          ctx.overlays = [];
          if (ctx.pin) ctx.map.removeAnnotation(ctx.pin);

          // MapKit hands back an unstyled overlay, which renders as a hairline
          // that vanishes over a motorway or a park. Style the core, and draw a
          // wider near-black casing underneath so the line owns its own edge.
          const styles = routeStrokeStyles(ctx.mk, ROUTE_WEIGHT.planner);
          const core: MapKitPolyline = route.polyline;
          const casing = casingForPolyline(ctx.mk, core, ROUTE_WEIGHT.planner);
          core.style = styles.core;
          if (casing) {
            ctx.map.addOverlay(casing); // insertion order = paint order
            ctx.overlays.push(casing);
          }
          ctx.map.addOverlay(core);
          ctx.overlays.push(core);

          ctx.pin = new ctx.mk.MarkerAnnotation(dest, {
            color: MARKER_INK.finish,
            glyphColor: MARKER_INK.onAccent,
            glyphText: "B",
            title: place.name,
            subtitle: t("map.destination"),
            accessibilityLabel: `${t("map.destination")}: ${place.name ?? ""}`,
          });
          ctx.map.addAnnotation(ctx.pin);

          // Frame the real route geometry (not just the origin/destination
          // pair, which underframes any route that detours), with 32px of
          // inset so neither end sits under the frame's edge or the callout.
          frameItems(
            ctx.mk,
            ctx.map,
            [...ctx.overlays, ctx.pin],
            [
              [p.coords.latitude, p.coords.longitude],
              [place.coordinate.latitude, place.coordinate.longitude],
            ],
            { padding: 32, animate: true },
          );
          setInfo({
            km: Math.round(route.distance / 100) / 10,
            eta: fmtDuration(route.expectedTravelTime, t),
            name: place.name ?? "",
          });
          track("route_planned", { km: Math.round(route.distance / 1000) });
        });
      },
      () => {
        setBusy(false);
        pushToast({ variant: "danger", title: t("map.locationNeeded") });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={t("map.searchPlaceholder")}
        />
        <Button variant="accent" onClick={search} disabled={busy}>
          <SearchIcon className="h-4 w-4" />
        </Button>
      </div>

      {results.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-1 p-2">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => routeTo(r)}
                className="flex items-start gap-2 rounded-xl p-2 text-left text-sm hover:bg-surface-elev dark:hover:bg-surface-elev-dark"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent-dim" />
                <span>
                  <span className="font-medium">{r.name}</span>
                  {r.formattedAddress && (
                    <span className="block text-[12px] text-muted dark:text-muted-dark">
                      {r.formattedAddress}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {info && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">{info.name}</div>
              {/* The map's text equivalent, and the answer to "how far is it?" */}
              <div className="text-[13px] text-muted dark:text-muted-dark">
                <span className="num">{info.km} km</span> · {info.eta}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <MapSurface
        innerRef={mapRef}
        state={mapState}
        onRetry={() => setAttempt((n) => n + 1)}
        className="h-[46vh] min-h-[300px]"
        label={
          info
            ? t("map.routeAlt", { name: info.name, km: info.km, eta: info.eta })
            : t("map.mapAlt")
        }
      />
    </div>
  );
}

// ─── group ride ───────────────────────────────────────────────────────────────

function GroupRide() {
  const { t } = useTranslation();
  const ride = useActiveRide();
  const create = useCreateRide();
  const join = useJoinRide();
  const leave = useLeaveRide();
  const [code, setCode] = useState("");

  if (ride.isLoading) return <Skeleton className="h-40 rounded-2xl" />;

  if (!ride.data) {
    return (
      <div className="flex flex-col gap-3">
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-[14px] text-muted dark:text-muted-dark">{t("map.togetherIntro")}</p>
            <Button
              variant="accent"
              disabled={create.isPending}
              onClick={() =>
                create.mutate(undefined, {
                  onSuccess: () => track("ride_created"),
                  onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }),
                })
              }
            >
              <Users className="h-4 w-4" /> {t("map.startRide")}
            </Button>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t("map.codePlaceholder")}
                className="num uppercase"
                maxLength={8}
              />
              <Button
                variant="outline"
                disabled={join.isPending || code.trim().length < 4}
                onClick={() =>
                  join.mutate(code.trim(), {
                    onSuccess: () => track("ride_joined"),
                    onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }),
                  })
                }
              >
                {t("map.join")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ActiveRide groupId={ride.data.id} code={ride.data.code} isOwner={ride.data.isOwner} onLeave={() => leave.mutate()} leaving={leave.isPending} />;
}

function ActiveRide({
  groupId, code, isOwner, onLeave, leaving,
}: {
  groupId: string;
  code: string;
  isOwner: boolean;
  onLeave: () => void;
  leaving: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { live, ended } = useRideChannel(groupId, {
    title: t("brand"),
    message: t("map.backgroundSharing"),
  });
  const mapRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ mk: MapKitNS; map: MapKitMap; pins: Map<string, unknown> } | null>(null);
  /** Auto-framing stops the moment the rider takes control of the map. */
  const userMoved = useRef(false);
  const framing = useRef(false);
  const lastFit = useRef(0);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [attempt, setAttempt] = useState(0);
  // Re-render on a timer so a rider who stops reporting goes stale on screen
  // even while no roster update arrives.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMapState("loading");
    loadMapKit()
      .then((mk) => {
        if (cancelled || !mapRef.current) return;
        const map = new mk.Map(mapRef.current, {
          // Muted: the riders are the content, the city is context.
          ...baseMapOptions(mk, prefersDarkScheme(), true),
          showsUserLocation: true,
          tracksUserLocation: false,
        });
        // A pan or a pinch means "I'm looking at something" — stop yanking the
        // region away on the next roster tick. Our own fits are suppressed.
        const claim = () => {
          if (!framing.current) userMoved.current = true;
        };
        map.addEventListener?.("scroll-start", claim);
        map.addEventListener?.("zoom-start", claim);
        ctx.current = { mk, map, pins: new Map() };
        setMapState("ready");
      })
      .catch(() => {
        if (!cancelled) setMapState("failed");
      });
    return () => {
      cancelled = true;
      ctx.current?.map.destroy();
      ctx.current = null;
      userMoved.current = false;
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

  // Sync member annotations with the latest roster.
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const now = Date.now();
    const seen = new Set<string>();
    const placed: unknown[] = [];
    const points: [number, number][] = [];
    for (const m of live) {
      if (!m.pos) continue;
      seen.add(m.userId);
      const existing = c.pins.get(m.userId);
      if (existing) c.map.removeAnnotation(existing);
      // A fix older than POSITION_STALE_MS is a guess: it goes grey and the
      // callout says how old it is, so it can never be read as "here, now".
      const stale = ended || isPositionStale(m.pos.t, now);
      const status = stale ? staleLabel(m.pos.t, now, t) : t("map.live");
      const pin = new c.mk.MarkerAnnotation(new c.mk.Coordinate(m.pos.lat, m.pos.lng), {
        title: m.name,
        subtitle: status,
        color: stale ? MARKER_INK.riderStale : MARKER_INK.riderLive,
        // Locale-aware: Turkish "i" upper-cases to "İ", not "I".
        glyphText: m.name.slice(0, 1).toLocaleUpperCase(i18n.language),
        accessibilityLabel: `${m.name} — ${status}`,
        displayPriority: stale ? 250 : 750,
        // The roster refreshes every few seconds; re-dropping every pin each
        // time would make the map twitch.
        animates: false,
      });
      c.pins.set(m.userId, pin);
      c.map.addAnnotation(pin);
      placed.push(pin);
      points.push([m.pos.lat, m.pos.lng]);
    }
    for (const [userId, pin] of c.pins) {
      if (!seen.has(userId)) {
        c.map.removeAnnotation(pin);
        c.pins.delete(userId);
      }
    }
    // Keep the whole group in view until the rider takes over the map — one
    // member's position is not a useful frame once a second rider joins.
    // Throttled: the roster refreshes every few seconds and a map that re-fits
    // that often is unusable.
    const firstFit = lastFit.current === 0;
    if (points.length > 0 && !userMoved.current && (firstFit || Date.now() - lastFit.current > 5000)) {
      lastFit.current = Date.now();
      framing.current = true;
      frameItems(c.mk, c.map, placed, points, { padding: 40, animate: !firstFit });
      setTimeout(() => {
        framing.current = false;
      }, 0);
    }
  }, [live, ended, mapState, tick, t, i18n.language]);

  async function shareCode() {
    const text = t("map.shareText", { code });
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(code);
        pushToast({ variant: "success", title: t("map.codeCopied") });
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <button type="button" onClick={() => void shareCode()} className="flex items-center gap-2">
            <span className="num text-[22px] font-semibold tracking-[0.2em]">{code}</span>
            <Copy className="h-4 w-4 text-muted dark:text-muted-dark" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted dark:text-muted-dark">
              {t("map.riders", { count: live.length })}
            </span>
            <Button size="sm" variant="outline" onClick={onLeave} disabled={leaving}>
              <LogOut className="h-4 w-4" /> {isOwner ? t("map.endRide") : t("map.leaveRide")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {ended && (
        <p className="text-center text-[13px] text-muted dark:text-muted-dark">{t("map.rideEnded")}</p>
      )}

      <MapSurface
        innerRef={mapRef}
        state={mapState}
        onRetry={() => setAttempt((n) => n + 1)}
        className="h-[52vh] min-h-[320px]"
        label={t("map.rideMapAlt", { count: live.filter((m) => m.pos).length })}
      />

      {/* The map's text equivalent: who is on it, and whether they're current. */}
      <MemberChips members={live} ended={ended} />
    </div>
  );
}

/**
 * "last seen 3 min ago", or a plain "out of date" for the first minute — a fix
 * 40s old is stale but "0 min ago" would read as a bug.
 */
function staleLabel(tsMs: number, now: number, t: (k: string, o?: Record<string, unknown>) => string) {
  const mins = minutesSince(tsMs, now);
  return mins < 1 ? t("map.lastSeenRecent") : t("map.lastSeen", { count: mins });
}

function MemberChips({ members, ended }: { members: RideMember[]; ended: boolean }) {
  const { t } = useTranslation();
  const now = Date.now();
  return (
    <ul className="flex flex-wrap gap-1.5">
      {members.map((m) => {
        const stale = !!m.pos && (ended || isPositionStale(m.pos.t, now));
        const live = !!m.pos && !stale;
        return (
          <li
            key={m.userId}
            className={`rounded-full px-3 py-1 text-[12px] ring-1 ${
              live
                ? "bg-accent/10 text-accent-dim ring-accent/30"
                : stale
                  ? "bg-warning/10 text-warning ring-warning/30"
                  : "bg-surface text-muted ring-border dark:bg-surface-elev-dark dark:text-muted-dark dark:ring-border-dark"
            }`}
          >
            {/* Never state by colour alone — the status is spelled out. */}
            {m.name}
            {stale && <span className="ml-1 opacity-80">· {staleLabel(m.pos!.t, now, t)}</span>}
            {!m.pos && <span className="ml-1 opacity-80">· {t("map.noFix")}</span>}
          </li>
        );
      })}
    </ul>
  );
}
