import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Plus, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DatedItem, DatedItemType } from "@mototracker/shared";
import { statusFor, statusColorClass, statusRingClass } from "@/lib/datedItems";
import { cn } from "@/lib/cn";

interface Props {
  type: DatedItemType;
  bikeId: string;
  item: DatedItem | null;
}

export function StatusChip({ type, bikeId, item }: Props) {
  const { t } = useTranslation();
  const info = statusFor(item?.expiresOn);
  const label = t(`items.${type}`);
  const color = statusColorClass(info.status);
  const ring = statusRingClass(info.status);

  const Icon = (() => {
    switch (info.status) {
      case "ok":
        return CheckCircle2;
      case "soon":
        return Clock;
      case "danger":
      case "expired":
        return AlertTriangle;
      case "unset":
        return Plus;
    }
  })();

  const linkTo = item
    ? `/dated-items/${item.id}`
    : `/bikes/${bikeId}/dated-items/new?type=${type}`;

  return (
    <Link to={linkTo} className="block touch-manipulation focus-visible:outline-none">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "relative overflow-hidden rounded-2xl border p-4 transition",
          color,
          ring,
          (info.status === "danger" || info.status === "expired") &&
            "after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:ring-2 after:ring-danger/0 after:animate-[pulse_1.6s_ease-in-out_infinite]",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-85">
            {label}
          </span>
          <Icon className="h-4 w-4 opacity-70" />
        </div>

        {/* Hero numeral or call-to-action */}
        {info.status === "unset" ? (
          <div className="mt-3 flex flex-col gap-0.5">
            <span className="text-sm font-medium text-text dark:text-text-dark">
              {t("items.addDate")}
            </span>
            <span className="text-xs text-muted dark:text-muted-dark">
              {t("items.manualAdd")}
            </span>
          </div>
        ) : info.daysRemaining === null ? (
          <div className="mt-3 font-mono text-3xl font-semibold tabular-nums leading-none">
            —
          </div>
        ) : info.daysRemaining < 0 ? (
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums leading-none">
              {t("items.expired")}
            </span>
          </div>
        ) : (
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-mono text-[44px] font-semibold tabular-nums leading-none tracking-tight">
              {info.daysRemaining}
            </span>
            <span className="text-xs font-medium opacity-80">{t("items.daysLeft")}</span>
          </div>
        )}

        {/* Footer: date or sub */}
        {item?.expiresOn && info.status !== "unset" && (
          <div className="mt-2 font-mono text-[11px] opacity-70">{item.expiresOn}</div>
        )}
        {info.status === "expired" && info.daysRemaining !== null && (
          <div className="mt-1 text-xs opacity-80">
            {Math.abs(info.daysRemaining)} {t("items.daysLeft").replace(/kaldı|left/, "").trim() || "gün"}
          </div>
        )}
      </motion.div>
    </Link>
  );
}
