import { motion } from "framer-motion";
import type { DashboardEntry } from "@mototracker/shared";
import { cn } from "@/lib/cn";

interface Props {
  entries: DashboardEntry[];
  activeBikeId: string | undefined;
  onSelect: (bikeId: string) => void;
}

export function BikeSwitcher({ entries, activeBikeId, onSelect }: Props) {
  if (entries.length <= 1) return null;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {entries.map((e) => {
        const active = e.bike.id === activeBikeId;
        return (
          <button
            key={e.bike.id}
            onClick={() => onSelect(e.bike.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition",
              active
                ? "border-accent text-text dark:text-text-dark"
                : "border-border text-muted hover:text-text dark:border-border-dark dark:text-muted-dark dark:hover:text-text-dark",
            )}
          >
            {active && (
              <motion.span
                layoutId="bike-pill-bg"
                className="absolute inset-0 -z-10 rounded-full bg-accent/15"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="font-medium">{e.bike.nickname}</span>
            {e.bike.plate && <span className="font-mono text-xs opacity-70">{e.bike.plate}</span>}
          </button>
        );
      })}
    </div>
  );
}
