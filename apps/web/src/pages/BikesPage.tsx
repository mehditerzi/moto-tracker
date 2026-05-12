import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Bike as BikeIcon, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBikes } from "@/hooks/useBikes";

export function BikesPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useBikes();

  if (isLoading) {
    return (
      <p className="text-center text-muted dark:text-muted-dark">{t("dashboard.loading")}</p>
    );
  }
  if (isError) {
    return <p className="text-center text-danger">{t("dashboard.loadFailed")}</p>;
  }

  if (!data || data.length === 0) {
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
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.myBikes")}</h1>
        <Button asChild size="sm" variant="accent">
          <Link to="/bikes/new">
            <Plus className="h-4 w-4" /> {t("dashboard.add")}
          </Link>
        </Button>
      </header>
      <div className="grid gap-3">
        {data.map((b) => (
          <motion.div key={b.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Link to={`/bikes/${b.id}/edit`} className="block">
              <Card className="flex items-center justify-between p-5 transition hover:border-accent hover:shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
                    <BikeIcon className="h-5 w-5 text-muted dark:text-muted-dark" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{b.nickname}</div>
                    <div className="truncate text-sm text-muted dark:text-muted-dark">
                      {[b.make, b.model, b.year].filter(Boolean).join(" · ") || "—"}
                    </div>
                    {b.plate && (
                      <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted dark:text-muted-dark">
                        {b.plate}
                      </div>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted dark:text-muted-dark" />
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
