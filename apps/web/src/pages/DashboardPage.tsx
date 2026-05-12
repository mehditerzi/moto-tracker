import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Bike as BikeIcon, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/hooks/useDashboard";
import { StatusChip } from "@/components/StatusChip";
import { BikeSwitcher } from "@/components/BikeSwitcher";
import { TYPE_ORDER } from "@/lib/datedItems";
import { CaptureFab } from "@/components/CaptureFab";
import { MaintenancePanel } from "@/components/MaintenancePanel";

export function DashboardPage() {
  const { t } = useTranslation();
  const dash = useDashboard();
  const [activeBikeId, setActiveBikeId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (dash.data && dash.data.length > 0 && !activeBikeId) {
      setActiveBikeId(dash.data[0]!.bike.id);
    }
  }, [dash.data, activeBikeId]);

  if (dash.isLoading) {
    return (
      <p className="text-center text-muted dark:text-muted-dark">{t("dashboard.loading")}</p>
    );
  }
  if (dash.isError || !dash.data) {
    return <p className="text-center text-danger">{t("dashboard.loadFailed")}</p>;
  }

  if (dash.data.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center"
      >
        <div className="relative grid h-24 w-24 place-items-center rounded-3xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
          <span
            aria-hidden
            className="absolute inset-0 rounded-3xl bg-accent/5"
          />
          <BikeIcon className="relative h-11 w-11 text-muted dark:text-muted-dark" strokeWidth={1.6} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-tight">
            {t("dashboard.empty")}
          </h1>
          <p className="text-pretty text-[15px] text-muted dark:text-muted-dark">
            {t("dashboard.emptySub")}
          </p>
        </div>
        <Button asChild variant="accent" size="lg">
          <Link to="/bikes/new">
            <Plus className="h-4 w-4" /> {t("dashboard.addBike")}
          </Link>
        </Button>
        <CaptureFab />
      </motion.div>
    );
  }

  const active = (dash.data.find((e) => e.bike.id === activeBikeId) ?? dash.data[0])!;

  return (
    <div className="flex flex-col gap-5">
      <BikeSwitcher
        entries={dash.data}
        activeBikeId={active.bike.id}
        onSelect={setActiveBikeId}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={active.bike.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col gap-5"
        >
          {/* Bike identity strip — wordmark on the left, edit on the right */}
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="label-micro text-muted dark:text-muted-dark">
                {t("dashboard.active")}
              </div>
              <h1 className="mt-1.5 truncate text-[32px] font-semibold leading-none tracking-tight">
                {active.bike.nickname}
              </h1>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-muted dark:text-muted-dark">
                <span className="truncate">
                  {[active.bike.make, active.bike.model, active.bike.year]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
                {active.bike.plate && (
                  <span className="num text-xs uppercase tracking-wider">
                    {active.bike.plate}
                  </span>
                )}
              </div>
            </div>
            <Button asChild variant="outline" size="icon" aria-label={t("dashboard.edit")}>
              <Link to={`/bikes/${active.bike.id}/edit`}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
          </header>

          {/* Status row — instrument cluster */}
          <section
            className="grid gap-3 sm:grid-cols-3"
            aria-label={t("dashboard.active")}
          >
            {TYPE_ORDER.map((type, i) => (
              <StatusChip
                key={type}
                type={type}
                bikeId={active.bike.id}
                item={active.items[type]}
                index={i}
              />
            ))}
          </section>

          <MaintenancePanel bikeId={active.bike.id} />
        </motion.div>
      </AnimatePresence>

      <div className="mb-safe mt-4 flex items-center justify-center">
        <Button asChild size="sm" variant="ghost" className="text-muted dark:text-muted-dark">
          <Link to="/bikes">
            <Settings2 className="h-3.5 w-3.5" /> {t("dashboard.manageBikes")}
          </Link>
        </Button>
      </div>
      <CaptureFab bikeId={active.bike.id} />
    </div>
  );
}
