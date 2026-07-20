import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, LogOut, MapPin, Search as SearchIcon, Users } from "lucide-react";
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
import { loadMapKit, type MapKitMap, type MapKitNS, type MapKitSearchResult } from "@/lib/mapkit";
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

// ─── route planner ────────────────────────────────────────────────────────────

function fmtDuration(seconds: number, t: (k: string, o?: Record<string, unknown>) => string) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? t("map.durationHm", { h, m }) : t("map.durationM", { m });
}

function RoutePlanner() {
  const { t } = useTranslation();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<{ mk: MapKitNS; map: MapKitMap; overlay?: unknown; pin?: unknown } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapKitSearchResult[]>([]);
  const [info, setInfo] = useState<{ km: number; eta: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Map boots once, centered on the user.
  useEffect(() => {
    let cancelled = false;
    loadMapKit().then((mk) => {
      if (cancelled || !mapRef.current) return;
      const map = new mk.Map(mapRef.current, { showsMapTypeControl: false, isRotationEnabled: false });
      mapObj.current = { mk, map };
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
    });
    return () => {
      cancelled = true;
      mapObj.current?.map.destroy();
      mapObj.current = null;
    };
  }, []);

  function search() {
    const ctx = mapObj.current;
    if (!ctx || query.trim().length < 2) return;
    new ctx.mk.Search({ language: navigator.language }).search(query, (err, data) => {
      if (err) {
        pushToast({ variant: "danger", title: t("map.searchFailed") });
        return;
      }
      setResults(data.places.slice(0, 6));
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
          if (ctx.overlay) ctx.map.removeOverlay(ctx.overlay);
          if (ctx.pin) ctx.map.removeAnnotation(ctx.pin);
          ctx.overlay = route.polyline;
          ctx.map.addOverlay(route.polyline);
          ctx.pin = new ctx.mk.MarkerAnnotation(dest, { color: "#A8C235", title: place.name });
          ctx.map.addAnnotation(ctx.pin);
          const midLat = (p.coords.latitude + place.coordinate.latitude) / 2;
          const midLng = (p.coords.longitude + place.coordinate.longitude) / 2;
          ctx.map.setRegionAnimated(
            new ctx.mk.CoordinateRegion(
              new ctx.mk.Coordinate(midLat, midLng),
              new ctx.mk.CoordinateSpan(
                Math.max(Math.abs(p.coords.latitude - place.coordinate.latitude) * 1.5, 0.02),
                Math.max(Math.abs(p.coords.longitude - place.coordinate.longitude) * 1.5, 0.02),
              ),
            ),
            true,
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
              <div className="text-[13px] text-muted dark:text-muted-dark">
                <span className="num">{info.km} km</span> · {info.eta}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="h-[46vh] overflow-hidden rounded-2xl ring-1 ring-border dark:ring-border-dark">
        <div ref={mapRef} className="h-full w-full" />
      </div>
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
  const { t } = useTranslation();
  const { live, ended } = useRideChannel(groupId);
  const mapRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ mk: MapKitNS; map: MapKitMap; pins: Map<string, unknown> } | null>(null);
  const centered = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadMapKit().then((mk) => {
      if (cancelled || !mapRef.current) return;
      const map = new mk.Map(mapRef.current, { showsMapTypeControl: false, isRotationEnabled: false });
      ctx.current = { mk, map, pins: new Map() };
    });
    return () => {
      cancelled = true;
      ctx.current?.map.destroy();
      ctx.current = null;
    };
  }, []);

  // Sync member annotations with the latest roster.
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const seen = new Set<string>();
    for (const m of live) {
      if (!m.pos) continue;
      seen.add(m.userId);
      const existing = c.pins.get(m.userId);
      if (existing) c.map.removeAnnotation(existing);
      const pin = new c.mk.MarkerAnnotation(new c.mk.Coordinate(m.pos.lat, m.pos.lng), {
        title: m.name,
        color: "#A8C235",
        glyphText: m.name.slice(0, 1).toUpperCase(),
      });
      c.pins.set(m.userId, pin);
      c.map.addAnnotation(pin);
    }
    for (const [userId, pin] of c.pins) {
      if (!seen.has(userId)) {
        c.map.removeAnnotation(pin);
        c.pins.delete(userId);
      }
    }
    // First position fixes the region.
    const first = live.find((m) => m.pos);
    if (first?.pos && !centered.current) {
      centered.current = true;
      c.map.setRegionAnimated(
        new c.mk.CoordinateRegion(
          new c.mk.Coordinate(first.pos.lat, first.pos.lng),
          new c.mk.CoordinateSpan(0.05, 0.05),
        ),
        false,
      );
    }
  }, [live]);

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

      <div className="h-[52vh] overflow-hidden rounded-2xl ring-1 ring-border dark:ring-border-dark">
        <div ref={mapRef} className="h-full w-full" />
      </div>

      <MemberChips members={live} />
    </div>
  );
}

function MemberChips({ members }: { members: RideMember[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => (
        <span
          key={m.userId}
          className={`rounded-full px-3 py-1 text-[12px] ring-1 ${
            m.pos
              ? "bg-accent/10 text-accent-dim ring-accent/30"
              : "bg-surface text-muted ring-border dark:bg-surface-elev-dark dark:text-muted-dark dark:ring-border-dark"
          }`}
        >
          {m.name}
        </span>
      ))}
    </div>
  );
}
