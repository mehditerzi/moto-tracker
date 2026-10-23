import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  BatteryCharging,
  Bookmark,
  Droplets,
  Fuel,
  Hospital,
  Loader2,
  LocateFixed,
  Navigation2,
  Phone,
  Disc3,
  SquareParking,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { MechanicSheet, type MechanicDraft } from "@/pages/MechanicsPage";
import {
  baseMapOptions,
  loadMapKit,
  prefersDarkScheme,
  type MapKitMap,
  type MapKitNS,
  type MapKitSearchResult,
} from "@/lib/mapkit";
import { getCurrentFix } from "@/lib/currentPosition";
import { haversineKm } from "@/lib/geo";
import { mapsHref, telHref } from "@/lib/contact";
import { formatNumber } from "@/lib/format";
import { hapticSelection, hapticTap } from "@/lib/haptics";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";
import type { MechanicSpecialty } from "@mototracker/shared";

interface Category {
  id: string;
  icon: LucideIcon;
  /** What we ask MapKit for, per UI language. */
  query: { tr: string; en: string };
  /** MapKit's own POI category, when it has one — sharper than text search. */
  poi?: string;
  /** Saving a result from this category files it under this specialty. */
  specialty?: MechanicSpecialty;
  color: string;
}

const CATEGORIES: Category[] = [
  { id: "fuel", icon: Fuel, query: { tr: "Benzin istasyonu", en: "Gas station" }, poi: "GasStation", color: "#E1FF4D" },
  { id: "ev", icon: BatteryCharging, query: { tr: "Elektrikli araç şarj istasyonu", en: "EV charger" }, poi: "EVCharger", color: "#4ade80" },
  { id: "service", icon: Wrench, query: { tr: "Oto servis", en: "Car repair" }, specialty: "general", color: "#38bdf8" },
  { id: "tires", icon: Disc3, query: { tr: "Lastikçi", en: "Tire shop" }, specialty: "tires", color: "#a78bfa" },
  { id: "parking", icon: SquareParking, query: { tr: "Otopark", en: "Parking" }, poi: "Parking", color: "#60a5fa" },
  { id: "wash", icon: Droplets, query: { tr: "Oto yıkama", en: "Car wash" }, color: "#22d3ee" },
  { id: "tow", icon: Truck, query: { tr: "Oto kurtarma çekici", en: "Tow truck" }, specialty: "tow", color: "#fb923c" },
  { id: "hospital", icon: Hospital, query: { tr: "Hastane", en: "Hospital" }, poi: "Hospital", color: "#f87171" },
];

interface Place {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  km: number | null;
}

type Status = "loading-map" | "locating" | "searching" | "ready" | "no-location" | "map-error";

/** MapKit Place objects carry more than our minimal typing admits. */
type RichPlace = MapKitSearchResult & { telephone?: string; id?: string };

export function NearbyPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "tr";
  const [params, setParams] = useSearchParams();
  const initial = CATEGORIES.find((c) => c.id === params.get("c")) ?? CATEGORIES[0]!;
  const [category, setCategory] = useState<Category>(initial);
  const [status, setStatus] = useState<Status>("loading-map");
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<MechanicDraft | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ mk: MapKitNS; map: MapKitMap; pins: unknown[] } | null>(null);
  const me = useRef<{ lat: number; lng: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── map ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadMapKit()
      .then((mk) => {
        if (cancelled || !el.current) return;
        const map = new mk.Map(el.current, {
          ...baseMapOptions(mk, prefersDarkScheme(), true),
          showsUserLocation: true,
          showsPointsOfInterest: false,
        });
        ctx.current = { mk, map, pins: [] };
        setStatus("locating");
      })
      .catch(() => !cancelled && setStatus("map-error"));
    return () => {
      cancelled = true;
      ctx.current?.map.destroy();
      ctx.current = null;
    };
  }, []);

  const locate = useCallback(async () => {
    setStatus("locating");
    try {
      const f = await getCurrentFix(12_000);
      me.current = { lat: f.lat, lng: f.lng };
      const c = ctx.current;
      if (c) {
        c.map.setRegionAnimated(
          new c.mk.CoordinateRegion(new c.mk.Coordinate(f.lat, f.lng), new c.mk.CoordinateSpan(0.05, 0.05)),
          true,
        );
      }
      setStatus("searching");
    } catch {
      setStatus("no-location");
    }
  }, []);

  useEffect(() => {
    if (status === "locating" && ctx.current && !me.current) void locate();
  }, [status, locate]);

  // ── search ─────────────────────────────────────────────────────────────────
  const search = useCallback(
    (cat: Category) => {
      const c = ctx.current;
      if (!c) return;
      setSelected(null);
      const at = me.current;
      const opts: Record<string, unknown> = { language: lang === "en" ? "en" : "tr" };
      if (at) {
        opts.region = new c.mk.CoordinateRegion(new c.mk.Coordinate(at.lat, at.lng), new c.mk.CoordinateSpan(0.08, 0.08));
      } else if (c.map.region) {
        opts.region = c.map.region;
      }
      const mkAny = c.mk as unknown as {
        PointOfInterestFilter?: { including(cats: unknown[]): unknown };
        PointOfInterestCategory?: Record<string, unknown>;
      };
      const poi = cat.poi ? mkAny.PointOfInterestCategory?.[cat.poi] : undefined;
      if (poi && mkAny.PointOfInterestFilter) opts.pointOfInterestFilter = mkAny.PointOfInterestFilter.including([poi]);

      new c.mk.Search(opts).search(cat.query[lang], (err, data) => {
        if (ctx.current !== c) return;
        if (err) {
          setPlaces([]);
          setStatus("ready");
          return;
        }
        const found: Place[] = (data.places as RichPlace[]).slice(0, 15).map((p, i) => {
          const lat = p.coordinate.latitude;
          const lng = p.coordinate.longitude;
          return {
            id: p.id ?? `${lat},${lng},${i}`,
            name: p.name ?? p.displayLines?.[0] ?? "",
            address: p.formattedAddress ?? p.displayLines?.slice(1).join(", ") ?? "",
            lat,
            lng,
            phone: p.telephone ?? null,
            km: at ? haversineKm(at, { lat, lng }) : null,
          };
        });
        found.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
        setPlaces(found);
        setStatus("ready");
        drawPins(found, cat);
        track("nearby_search", { category: cat.id, results: found.length });
      });
    },
    [lang],
  );

  const drawPins = (found: Place[], cat: Category) => {
    const c = ctx.current;
    if (!c) return;
    for (const p of c.pins) c.map.removeAnnotation(p);
    c.pins = found.map((p, i) => {
      const pin = new c.mk.MarkerAnnotation(new c.mk.Coordinate(p.lat, p.lng), {
        color: cat.color,
        glyphColor: "#0B0B0E",
        glyphText: String(i + 1),
        title: p.name,
      }) as { addEventListener?: (t: string, f: () => void) => void };
      pin.addEventListener?.("select", () => {
        setSelected(p.id);
        hapticTap();
        listRef.current?.querySelector(`[data-place="${CSS.escape(p.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      c.map.addAnnotation(pin);
      return pin;
    });
    if (found.length && c.map.showItems) {
      const Padding = c.mk.Padding;
      c.map.showItems(c.pins, {
        animate: true,
        padding: Padding ? new Padding({ top: 40, right: 30, bottom: 30, left: 30 }) : undefined,
      });
    }
  };

  // One place runs a search: whenever we enter "searching", or the category
  // changes while we are there. Chips and the locate flow only set state.
  const searching = status === "searching";
  useEffect(() => {
    if (searching && ctx.current) search(category);
  }, [searching, category, search]);

  const pick = (cat: Category) => {
    if (cat.id === category.id) return;
    hapticSelection();
    setCategory(cat);
    setParams({ c: cat.id }, { replace: true });
    if (ctx.current && status !== "locating" && status !== "loading-map") setStatus("searching");
  };

  const busy = status === "loading-map" || status === "locating" || status === "searching";
  const selectedPlace = useMemo(() => places.find((p) => p.id === selected), [places, selected]);

  return (
    <div className="flex flex-col gap-3">
      <BackLink to="/assistant" />
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("nav.assistant")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{t("nearby.title")}</h1>
      </header>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="radiogroup" aria-label={t("nearby.category")}>
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const on = c.id === category.id;
          return (
            <motion.button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              whileTap={{ scale: 0.94 }}
              onClick={() => pick(c)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium ring-1 transition",
                on ? "bg-text text-bg ring-text dark:bg-text-dark dark:text-bg-dark" : "bg-surface ring-border dark:bg-surface-elev-dark dark:ring-border-dark",
              )}
            >
              <Icon className="h-4 w-4" style={on ? undefined : { color: c.color }} />
              {t(`nearby.cat.${c.id}`)}
            </motion.button>
          );
        })}
      </div>

      <div className="relative h-[42dvh] min-h-[260px] overflow-hidden rounded-3xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
        <div ref={el} className="absolute inset-0" />
        {status === "map-error" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13.5px] text-muted">{t("nearby.mapError")}</div>
        )}
        <AnimatePresence>
          {busy && status !== "loading-map" && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full bg-bg/90 px-3 py-1.5 text-[12.5px] font-medium shadow backdrop-blur dark:bg-bg-dark/90"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {status === "locating" ? t("nearby.locating") : t("nearby.searching")}
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          aria-label={t("nearby.recenter")}
          onClick={() => {
            hapticTap();
            me.current = null;
            void locate();
          }}
          className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-bg/95 shadow-lg ring-1 ring-border backdrop-blur dark:bg-bg-dark/95 dark:ring-border-dark"
        >
          <LocateFixed className="h-5 w-5" />
        </button>
      </div>

      {status === "no-location" && (
        <div className="rounded-2xl bg-amber-400/10 p-3.5 text-[13px] text-amber-700 dark:text-amber-300">
          {t("nearby.noLocation")}
          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setStatus("searching")}>
            {t("nearby.searchMapArea")}
          </Button>
        </div>
      )}

      <div ref={listRef} className="flex flex-col gap-2">
        {status === "ready" && places.length === 0 && (
          <p className="py-6 text-center text-[13.5px] text-muted dark:text-muted-dark">{t("nearby.none")}</p>
        )}
        {places.map((p, i) => (
          <motion.div
            key={p.id}
            data-place={p.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.03 }}
            onClick={() => {
              setSelected(p.id);
              const c = ctx.current;
              c?.map.setCenterAnimated?.(new c.mk.Coordinate(p.lat, p.lng), true);
            }}
            className={cn(
              "rounded-2xl bg-surface p-3.5 ring-1 transition dark:bg-surface-elev-dark",
              p.id === selectedPlace?.id ? "ring-2 ring-accent" : "ring-border dark:ring-border-dark",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className="num grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold text-black"
                style={{ background: category.color }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-semibold">{p.name}</div>
                <div className="line-clamp-1 text-[12.5px] text-muted dark:text-muted-dark">{p.address}</div>
              </div>
              {p.km != null && (
                <span className="num shrink-0 text-[12.5px] font-medium text-muted dark:text-muted-dark">
                  {p.km < 1 ? `${Math.round(p.km * 1000)} m` : `${formatNumber(p.km, 1)} km`}
                </span>
              )}
            </div>
            <div className="mt-2.5 flex gap-2">
              <Button asChild size="sm" variant="accent" className="flex-1">
                <a
                  href={mapsHref({ lat: p.lat, lng: p.lng, directions: true })}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("nearby_directions", { category: category.id })}
                >
                  <Navigation2 className="h-4 w-4" /> {t("common.directions")}
                </a>
              </Button>
              {p.phone && (
                <Button asChild size="sm" variant="outline" className="flex-1">
                  <a href={telHref(p.phone)}>
                    <Phone className="h-4 w-4" /> {t("common.call")}
                  </a>
                </Button>
              )}
              {category.specialty && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t("nearby.saveMechanic")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSaving({ name: p.name, phone: p.phone, address: p.address, lat: p.lat, lng: p.lng, specialty: category.specialty });
                  }}
                >
                  <Bookmark className="h-4 w-4" />
                </Button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <MechanicSheet open={!!saving} draft={saving ?? undefined} onClose={() => setSaving(null)} />
    </div>
  );
}
