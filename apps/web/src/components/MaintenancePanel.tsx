import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Wrench, ChevronRight, RotateCw } from "lucide-react";
import { addMonths, parseISO, differenceInCalendarDays, format } from "date-fns";
import { useTranslation } from "react-i18next";
import type { MaintenanceItem } from "@mototracker/shared";
import { useMaintenanceForBike } from "@/hooks/useMaintenanceItems";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

function dueDate(m: MaintenanceItem): string | null {
  if (!m.lastDoneOn || !m.intervalMonths) return null;
  return format(addMonths(parseISO(m.lastDoneOn), m.intervalMonths), "yyyy-MM-dd");
}

interface Props {
  bikeId: string;
}

export function MaintenancePanel({ bikeId }: Props) {
  const { t } = useTranslation();
  const q = useMaintenanceForBike(bikeId);

  return (
    <motion.section
      layout
      className="rounded-2xl border border-dashed border-border bg-surface/40 p-4 dark:border-border-dark dark:bg-surface-elev-dark/40"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-muted dark:text-muted-dark" />
          <h2 className="label-micro text-muted dark:text-muted-dark">
            {t("maintenance.title")}
          </h2>
        </div>
        <Button asChild variant="ghost" size="sm" aria-label={t("dashboard.add")} className="-mr-2">
          <Link to={`/bikes/${bikeId}/maintenance/new`}>
            <Plus className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* A one-line "Yükleniyor…" is a third the height of the list it turns
          into, so the whole dashboard below it jumped as soon as the data
          landed. Two rows in the real row height hold the space instead. */}
      {q.isLoading ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-[46px] rounded-xl" />
          <Skeleton className="h-[46px] rounded-xl" />
        </div>
      ) : q.isError ? (
        // Was a red sentence with nothing to tap: the panel dead-ended on any
        // blip and only a full app reload brought it back.
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-danger">{t("dashboard.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RotateCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} />
            {t("common.retry")}
          </Button>
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-sm text-muted dark:text-muted-dark">{t("items.noMaintenance")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((m) => {
            const due = dueDate(m);
            const days = due ? differenceInCalendarDays(parseISO(due), new Date()) : null;
            const danger = days !== null && days <= 7;
            const label =
              m.kind === "custom"
                ? m.customLabel ?? t("maintenance.fallbackLabel")
                : t(`maintenance.kinds.${m.kind}`);
            return (
              <li key={m.id}>
                <Link
                  to={`/bikes/${bikeId}/maintenance/${m.id}`}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border bg-bg/60 p-3 text-sm transition hover:border-text/20 dark:bg-bg-dark/40 dark:hover:border-text-dark/20",
                    "border-border dark:border-border-dark",
                    danger && "border-danger/40 bg-danger/5 hover:border-danger/60",
                  )}
                >
                  <span className="font-medium">{label}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "num text-xs",
                        danger ? "text-danger" : "text-muted dark:text-muted-dark",
                      )}
                    >
                      {due
                        ? days === null
                          ? "—"
                          : days < 0
                            ? t("items.expired")
                            : `${days} ${t("items.daysLeft").split(" ")[0]}`
                        : "—"}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted dark:text-muted-dark" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}
