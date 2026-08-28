import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RideStats } from "@/hooks/useRide";

/**
 * What the ride was, once it is over.
 *
 * Computed entirely on the device from the position stream this screen was
 * already receiving, and thrown away when the card is dismissed — a group ride
 * deliberately leaves no record anywhere, and a summary that outlived the ride
 * would be exactly such a record. Distance covered is separately (and
 * independently) captured by trip recording, if the rider has it on.
 */
export function RideSummary({ stats, onClose }: { stats: RideStats; onClose: () => void }) {
  const { t } = useTranslation();
  const minutes = Math.max(0, Math.round((Date.now() - stats.startedAt) / 60_000));
  const hours = Math.floor(minutes / 60);

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-bg/70 px-3 pb-6 backdrop-blur-sm dark:bg-bg-dark/70">
      <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-card ring-1 ring-border dark:bg-surface-dark dark:shadow-card-dark dark:ring-border-dark">
        <div className="label-micro text-muted dark:text-muted-dark">{t("map.rideOver")}</div>
        <h2 className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight">
          {t("map.summaryTitle")}
        </h2>

        <dl className="mt-5 grid grid-cols-3 gap-3">
          <Stat
            label={t("map.summaryDistance")}
            value={stats.distanceKm < 10 ? stats.distanceKm.toFixed(1) : Math.round(stats.distanceKm).toString()}
            unit="km"
          />
          <Stat
            label={t("map.summaryTime")}
            value={
              hours > 0
                ? `${hours}:${String(minutes % 60).padStart(2, "0")}`
                : minutes.toString()
            }
            unit={hours > 0 ? t("map.hourShort") : t("map.minUnit")}
          />
          <Stat
            label={t("map.summaryRiders")}
            value={Math.max(1, stats.peakRiders).toString()}
            icon={<Users className="h-4 w-4" strokeWidth={1.9} />}
          />
        </dl>

        <p className="mt-4 text-[13px] leading-relaxed text-muted dark:text-muted-dark">
          {t("map.summaryPrivacy")}
        </p>

        <Button variant="accent" size="lg" className="mt-4 h-14 w-full" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-elev p-3 dark:bg-surface-elev-dark">
      <dt className="label-micro text-muted dark:text-muted-dark">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1">
        <span className="num text-[24px] font-semibold leading-none">{value}</span>
        {unit && <span className="text-[12px] text-muted dark:text-muted-dark">{unit}</span>}
        {icon && <span className="text-muted dark:text-muted-dark">{icon}</span>}
      </dd>
    </div>
  );
}
