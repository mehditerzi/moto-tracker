import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Wrench } from "lucide-react";
import type { MaintenanceItem } from "@mototracker/shared";
import { addMonths, parseISO, differenceInCalendarDays, format } from "date-fns";
import { useMaintenanceForBike } from "@/hooks/useMaintenanceItems";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const KIND_LABEL_TR: Record<string, string> = {
  engine_oil: "Motor yağı",
  chain: "Zincir",
  brakes: "Fren",
  tires: "Lastik",
  coolant: "Soğutma",
  custom: "Bakım",
};

function dueDate(m: MaintenanceItem): string | null {
  if (!m.lastDoneOn || !m.intervalMonths) return null;
  return format(addMonths(parseISO(m.lastDoneOn), m.intervalMonths), "yyyy-MM-dd");
}

interface Props {
  bikeId: string;
}

export function MaintenancePanel({ bikeId }: Props) {
  const q = useMaintenanceForBike(bikeId);
  const items = q.data ?? [];

  return (
    <motion.div
      layout
      className="rounded-xl border border-border p-4 dark:border-border-dark"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted dark:text-muted-dark" />
          <h2 className="text-sm font-medium uppercase tracking-wider">Bakım</h2>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to={`/bikes/${bikeId}/maintenance/new`}>
            <Plus className="h-4 w-4" /> Ekle
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted dark:text-muted-dark">
          Henüz bakım kaydı yok.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => {
            const due = dueDate(m);
            const days = due ? differenceInCalendarDays(parseISO(due), new Date()) : null;
            const danger = days !== null && days <= 7;
            const label = m.kind === "custom" ? m.customLabel ?? "Bakım" : KIND_LABEL_TR[m.kind];
            return (
              <li key={m.id}>
                <Link
                  to={`/bikes/${bikeId}/maintenance/${m.id}`}
                  className={cn(
                    "flex items-center justify-between rounded-xl border p-3 text-sm",
                    "border-border dark:border-border-dark",
                    danger && "border-danger/40 bg-danger/5",
                  )}
                >
                  <span className="font-medium">{label}</span>
                  <span className="font-mono text-xs">
                    {due ? (
                      days === null ? (
                        "—"
                      ) : days < 0 ? (
                        "Geçti"
                      ) : (
                        `${days} gün`
                      )
                    ) : (
                      "—"
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
