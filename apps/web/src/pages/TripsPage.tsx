import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Navigation, Route as RouteIcon, MapPin, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useTrips, useTrip } from "@/hooks/useTrips";
import { useBikes } from "@/hooks/useBikes";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { TripMap } from "@/components/TripMap";
import { vehicleIcon } from "@/lib/vehicleType";
import { formatDate } from "@/lib/format";
import {
  useTripTrackingEnabled,
  setTripTrackingEnabled,
} from "@/lib/tripTracking";
import type { Bike } from "@mototracker/shared";

export function TripsPage() {
  const { t, i18n } = useTranslation();
  const trips = useTrips();
  const bikes = useBikes();
  const enabled = useTripTrackingEnabled();
  const cfg = usePublicConfig();
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const mapsOn = cfg.data?.mapkit ?? false;

  // Rebuilding this on every render meant walking the whole garage again just
  // to expand or collapse one trip row.
  const bikeById = useMemo(
    () => new Map<string, Bike>((bikes.data ?? []).map((b) => [b.id, b])),
    [bikes.data],
  );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("nav.trips")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
          {t("trips.title")}
        </h1>
      </header>

      <TrackingToggle enabled={enabled} onToggle={() => toggleTracking(!enabled)} />

      {(trips.data?.length ?? 0) > 0 && <TripInsights trips={trips.data!} />}

      {trips.isLoading ? (
        // 76px is the real row height (p-4 around a 44px icon). At h-16 the
        // list grew 12px per row the moment the data landed, shoving the page.
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-[76px] rounded-2xl" />
          <Skeleton className="h-[76px] rounded-2xl" />
        </div>
      ) : trips.isError ? (
        <ErrorState onRetry={() => void trips.refetch()} />
      ) : !trips.data || trips.data.length === 0 ? (
        <EmptyTrips />
      ) : (
        <div className="grid gap-2.5">
          {trips.data.map((trip, i) => {
            const bike = bikeById.get(trip.bikeId);
            const Icon = vehicleIcon(bike?.vehicleType);
            const expandable = mapsOn && trip.hasRoute;
            const open = openTripId === trip.id;
            return (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                // Capped. The API returns up to 200 trips, and an uncapped
                // `i * 0.04` meant the last card only began to appear eight
                // seconds after the list rendered — the whole screen read as
                // slow. Eight steps is enough to feel like a cascade.
                transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              >
                {/* The expandable row is a real control: it was a bare div with
                    an onClick, so the map could not be opened from a keyboard
                    and assistive tech was told nothing about the disclosure. */}
                <Card
                  className={`flex items-center justify-between gap-4 p-4 ${
                    expandable
                      ? "cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      : ""
                  } ${open ? "rounded-b-none" : ""}`}
                  role={expandable ? "button" : undefined}
                  tabIndex={expandable ? 0 : undefined}
                  aria-expanded={expandable ? open : undefined}
                  onClick={expandable ? () => setOpenTripId(open ? null : trip.id) : undefined}
                  onKeyDown={
                    expandable
                      ? (e: React.KeyboardEvent) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          setOpenTripId(open ? null : trip.id);
                        }
                      : undefined
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-bg ring-1 ring-border dark:bg-bg-dark dark:ring-border-dark">
                      <Icon className="h-5 w-5 text-muted dark:text-muted-dark" strokeWidth={1.6} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold">
                        {bike?.nickname ?? t("trips.unknownVehicle")}
                      </div>
                      <div className="text-[13px] text-muted dark:text-muted-dark">
                        {formatDate(trip.endedAt, i18n.language)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <div>
                      <span className="num text-[17px] font-semibold leading-none">
                        {Math.round(trip.distanceKm)}
                      </span>
                      <span className="ml-1 text-[12px] text-muted dark:text-muted-dark">km</span>
                    </div>
                    {expandable && (
                      <ChevronDown
                        className={`h-4 w-4 text-muted transition-transform dark:text-muted-dark ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    )}
                  </div>
                </Card>
                {open && <TripRoutepanel tripId={trip.id} />}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The expanded half of a trip row: fetches the full trip and draws its route. */
function TripRoutepanelInner({ tripId }: { tripId: string }) {
  const { t } = useTranslation();
  const trip = useTrip(tripId);
  if (trip.isLoading) return <Skeleton className="h-52 rounded-b-2xl" />;
  if (!trip.data?.route) {
    return (
      <p className="py-4 text-center text-[13px] text-muted dark:text-muted-dark">
        {t("trips.mapFailed")}
      </p>
    );
  }
  return <TripMap route={trip.data.route} />;
}

function TripRoutepanel({ tripId }: { tripId: string }) {
  return (
    <div className="rounded-b-2xl border border-t-0 border-border bg-surface p-2 dark:border-border-dark dark:bg-surface-dark">
      <TripRoutepanelInner tripId={tripId} />
    </div>
  );
}

function toggleTracking(next: boolean) {
  setTripTrackingEnabled(next);
  // Turning it on: nudge the OS permission prompt immediately so the user grants
  // location now rather than silently at the first drive.
  if (next && typeof navigator !== "undefined" && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      () => {},
      () => {},
      { enableHighAccuracy: true },
    );
  }
}

function TripInsights({ trips }: { trips: { distanceKm: number; endedAt: string }[] }) {
  const { t } = useTranslation();
  const now = new Date();
  let monthKm = 0;
  let totalKm = 0;
  for (const tr of trips) {
    totalKm += tr.distanceKm;
    const d = new Date(tr.endedAt);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthKm += tr.distanceKm;
  }
  const stat = (label: string, value: string) => (
    <div className="flex flex-col gap-0.5">
      <span className="num text-[20px] font-semibold leading-none">{value}</span>
      <span className="text-[11px] text-muted dark:text-muted-dark">{label}</span>
    </div>
  );
  return (
    <Card>
      <CardContent className="grid grid-cols-3 gap-3 p-4">
        {stat(t("trips.thisMonth"), `${Math.round(monthKm).toLocaleString()} km`)}
        {stat(t("trips.totalKm"), `${Math.round(totalKm).toLocaleString()} km`)}
        {stat(t("trips.count"), String(trips.length))}
      </CardContent>
    </Card>
  );
}

function TrackingToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              enabled
                ? "bg-accent/15 text-accent ring-1 ring-accent/40"
                : "bg-bg text-muted ring-1 ring-border dark:bg-bg-dark dark:text-muted-dark dark:ring-border-dark"
            }`}
          >
            <Navigation className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">{t("trips.tracking")}</div>
            <p className="mt-0.5 text-[13px] text-muted dark:text-muted-dark">
              {enabled ? t("trips.trackingOnHint") : t("trips.trackingOffHint")}
            </p>
          </div>
        </div>
        {/* The switch itself stays 44×24 — that is the design. The tappable
            element around it is 44px tall, which the bare track was not: this is
            the one control on the screen and it was missing a third of the
            minimum touch target. */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("trips.tracking")}
          onClick={onToggle}
          // -mt-1.5 + pt-2.5 reproduces the old `mt-1` offset exactly, so the
          // track does not move; only the hit area grows.
          className="-mb-2.5 -mt-1.5 flex min-h-[44px] shrink-0 touch-manipulation items-center py-2.5"
        >
          <span
            aria-hidden
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
              enabled ? "bg-accent" : "bg-border dark:bg-border-dark"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </CardContent>
    </Card>
  );
}

function EmptyTrips() {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col items-center gap-5 py-12 text-center"
    >
      <div className="relative grid h-20 w-20 place-items-center rounded-3xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
        <RouteIcon className="h-10 w-10 text-muted dark:text-muted-dark" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[20px] font-semibold tracking-tight">{t("trips.empty")}</h2>
        <p className="inline-flex items-center justify-center gap-1.5 text-[14px] text-muted dark:text-muted-dark">
          <MapPin className="h-3.5 w-3.5" /> {t("trips.emptySub", { km: 15 })}
        </p>
      </div>
    </motion.div>
  );
}
