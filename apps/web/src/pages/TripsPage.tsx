import { motion } from "framer-motion";
import { Navigation, Route as RouteIcon, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTrips } from "@/hooks/useTrips";
import { useBikes } from "@/hooks/useBikes";
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

  const bikeById = new Map<string, Bike>((bikes.data ?? []).map((b) => [b.id, b]));

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
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      ) : trips.isError ? (
        <p className="text-center text-danger">{t("dashboard.loadFailed")}</p>
      ) : !trips.data || trips.data.length === 0 ? (
        <EmptyTrips />
      ) : (
        <div className="grid gap-2.5">
          {trips.data.map((trip, i) => {
            const bike = bikeById.get(trip.bikeId);
            const Icon = vehicleIcon(bike?.vehicleType);
            return (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <Card className="flex items-center justify-between gap-4 p-4">
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
                  <div className="shrink-0 text-right">
                    <span className="num text-[17px] font-semibold leading-none">
                      {Math.round(trip.distanceKm)}
                    </span>
                    <span className="ml-1 text-[12px] text-muted dark:text-muted-dark">km</span>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
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
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("trips.tracking")}
          onClick={onToggle}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
            enabled ? "bg-accent" : "bg-border dark:bg-border-dark"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
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
