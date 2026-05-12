import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Bike as BikeIcon } from "lucide-react";
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
        className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center"
      >
        <div className="grid h-20 w-20 place-items-center rounded-3xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
          <BikeIcon className="h-10 w-10 text-muted dark:text-muted-dark" />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            {t("dashboard.empty")}
          </h1>
          <p className="text-pretty text-sm text-muted dark:text-muted-dark">
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
          className="flex flex-col gap-4"
        >
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted dark:text-muted-dark">
                {t("dashboard.active")}
              </div>
              <h1 className="mt-0.5 truncate text-3xl font-semibold tracking-tight">
                {active.bike.nickname}
              </h1>
              <p className="mt-1 truncate text-sm text-muted dark:text-muted-dark">
                {[active.bike.make, active.bike.model, active.bike.year]
                  .filter(Boolean)
                  .join(" · ") || "—"}
                {active.bike.plate && (
                  <span className="ml-2 font-mono text-xs uppercase tracking-wider">
                    {active.bike.plate}
                  </span>
                )}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" aria-label={t("dashboard.edit")}>
              <Link to={`/bikes/${active.bike.id}/edit`}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
          </header>

          <div className="grid gap-3 sm:grid-cols-3">
            {TYPE_ORDER.map((type) => (
              <StatusChip
                key={type}
                type={type}
                bikeId={active.bike.id}
                item={active.items[type]}
              />
            ))}
          </div>

          <MaintenancePanel bikeId={active.bike.id} />
        </motion.div>
      </AnimatePresence>

      <div className="mb-safe mt-2 flex items-center justify-center">
        <Button asChild size="sm" variant="ghost" className="text-muted dark:text-muted-dark">
          <Link to="/bikes">
            <Plus className="h-4 w-4" /> {t("dashboard.manageBikes")}
          </Link>
        </Button>
      </div>
      <CaptureFab bikeId={active.bike.id} />
    </div>
  );
}
