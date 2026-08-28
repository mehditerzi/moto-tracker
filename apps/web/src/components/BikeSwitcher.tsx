import { motion } from "framer-motion";
import type { DashboardEntry } from "@mototracker/shared";
import { cn } from "@/lib/cn";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import { OrgVehicleBadge } from "@/components/fleet/OrgVehicleBadge";

interface Props {
  entries: DashboardEntry[];
  activeBikeId: string | undefined;
  onSelect: (bikeId: string) => void;
  /**
   * Organization name for a company vehicle, or null for a personal one.
   * A driver must be able to tell which garage a pill belongs to WITHOUT
   * selecting it — the answer decides whether the routes they record are
   * visible to their employer. Absent for consumers, who have no org vehicles.
   */
  orgNameFor?: (bikeId: string) => string | null;
}

/**
 * Horizontal pill switcher. A lime fill plus a thin underline marks the
 * active bike — the underline is the "selected channel" indicator on a
 * radio dial.
 */
export function BikeSwitcher({ entries, activeBikeId, onSelect, orgNameFor }: Props) {
  if (entries.length <= 1) return null;
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden">
      {entries.map((e) => {
        const active = e.bike.id === activeBikeId;
        const orgName = orgNameFor?.(e.bike.id) ?? null;
        return (
          <button
            key={e.bike.id}
            onClick={() => onSelect(e.bike.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] transition min-h-[44px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              active
                ? "border-text/40 text-text dark:border-text-dark/40 dark:text-text-dark"
                : "border-border text-muted hover:text-text dark:border-border-dark dark:text-muted-dark dark:hover:text-text-dark",
            )}
            aria-pressed={active}
          >
            {active && (
              <motion.span
                layoutId="bike-pill-bg"
                className="absolute inset-0 -z-10 rounded-full bg-accent/15"
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            {/* The pill used to carry a bare grey glyph, which was identical on
                every vehicle — the one thing the switcher exists to tell apart.
                The tile is the same treatment as the hero and the list row, at
                pill scale, so a red bike reads as the red one everywhere. */}
            <VehicleAvatar
              vehicle={e.bike}
              size="thumb"
              className="h-5 w-5 shrink-0 rounded-md"
            />
            <span className="font-medium">{e.bike.nickname}</span>
            {e.bike.plate && (
              <span className="num text-[11px] uppercase tracking-wider opacity-70">
                {e.bike.plate}
              </span>
            )}
            {orgName && <OrgVehicleBadge orgName={orgName} size="sm" className="max-w-[140px]" />}
          </button>
        );
      })}
    </div>
  );
}
