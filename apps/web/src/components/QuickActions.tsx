import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ChevronRight, Fuel, FolderLock, Siren, Wallet, type LucideIcon } from "lucide-react";
import { useCostSummary } from "@/hooks/useAssistant";
import { CountUp } from "@/components/motion/CountUp";
import { formatMoney } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { cn } from "@/lib/cn";

const ACTIONS: { to: string; key: string; icon: LucideIcon; tint: string }[] = [
  { to: "/costs", key: "costs", icon: Wallet, tint: "text-amber-500 bg-amber-400/10" },
  { to: "/fuel", key: "fuel", icon: Fuel, tint: "text-accent-dim bg-accent/15 dark:text-accent" },
  { to: "/glovebox", key: "glovebox", icon: FolderLock, tint: "text-violet-500 bg-violet-400/10" },
  { to: "/sos", key: "sos", icon: Siren, tint: "text-red-500 bg-red-500/10" },
];

/**
 * The dashboard's second row: what this vehicle cost this month, and the four
 * things people reach for between deadlines — one tap each.
 */
export function QuickActions({ bikeId }: { bikeId: string }) {
  const { t } = useTranslation();
  const costs = useCostSummary(bikeId);
  const month = costs.data?.months.at(-1)?.total ?? null;
  return (
    <section className="flex flex-col gap-2.5" aria-label={t("dashboard.quick")}>
      {month !== null && month > 0 && (
        <Link
          to="/costs"
          className="group flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-border transition active:scale-[0.99] dark:bg-surface-elev-dark dark:ring-border-dark"
        >
          <span className="text-[13px] text-muted dark:text-muted-dark">{t("dashboard.spentThisMonth")}</span>
          <span className="flex items-center gap-1.5">
            <CountUp value={month} format={(n) => formatMoney(n)} className="num text-[17px] font-semibold" />
            <ChevronRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5 dark:text-muted-dark" />
          </span>
        </Link>
      )}
      <div className="grid grid-cols-4 gap-2">
        {ACTIONS.map(({ to, key, icon: Icon, tint }) => (
          <motion.div key={to} whileTap={{ scale: 0.92 }}>
            <Link
              to={to}
              onClick={() => hapticTap()}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface py-3 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
            >
              <span className={cn("grid h-10 w-10 place-items-center rounded-xl", tint)}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[11.5px] font-medium">{t(`dashboard.action.${key}`)}</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
