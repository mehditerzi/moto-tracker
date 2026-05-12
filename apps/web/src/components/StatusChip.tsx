import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Plus, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DatedItem, DatedItemType } from "@mototracker/shared";
import { statusFor, type Status, statusDotClass } from "@/lib/datedItems";
import { cn } from "@/lib/cn";

interface Props {
  type: DatedItemType;
  bikeId: string;
  item: DatedItem | null;
  /** 0-based index used to stagger the entrance animation. */
  index?: number;
}

/**
 * StatusChip — the dashboard hero. Designed as a single instrument-cluster
 * gauge: a colored hairline ring, a wide micro-label, the days-remaining
 * numeral set in tabular Geist Mono, and a subordinate ISO date underneath.
 *
 * Surfaces all four states (unset / ok / soon / danger / expired) with a
 * single shared layout so eyes can scan a row of them and compare values
 * at a glance — like reading three gauges on a bike's dash.
 */
export function StatusChip({ type, bikeId, item, index = 0 }: Props) {
  const { t } = useTranslation();
  const info = statusFor(item?.expiresOn);
  const label = t(`items.${type}`);

  const linkTo = item
    ? `/dated-items/${item.id}`
    : `/bikes/${bikeId}/dated-items/new?type=${type}`;

  return (
    <Link
      to={linkTo}
      className="group block touch-manipulation focus-visible:outline-none"
      aria-label={`${label} · ${describeStatus(info.status, info.daysRemaining, t)}`}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.32,
          delay: index * 0.06,
          ease: [0.2, 0.8, 0.2, 1],
        }}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        className={cn(
          "relative isolate overflow-hidden rounded-2xl border bg-surface/95 p-4 transition",
          "border-border shadow-card backdrop-blur-[2px]",
          "dark:border-border-dark dark:bg-surface-dark/85 dark:shadow-card-dark",
          info.status === "danger" || info.status === "expired"
            ? "border-danger/30 dark:border-danger/40 animate-danger-glow"
            : "",
        )}
      >
        {/* Hairline status edge — left-bar feels like an LED indicator */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-3 left-0 w-[3px] rounded-full",
            statusDotClass(info.status),
          )}
        />

        {/* Header: micro-label + status icon */}
        <div className="flex items-center justify-between pl-2">
          <span
            className={cn(
              "label-micro",
              info.status === "unset"
                ? "text-muted dark:text-muted-dark"
                : statusTextClass(info.status),
            )}
          >
            {label}
          </span>
          <StatusIcon status={info.status} />
        </div>

        {/* Body: hero numeral or call-to-action */}
        <div className="pl-2">
          {info.status === "unset" ? (
            <div className="mt-3 flex flex-col gap-0.5">
              <span className="text-[15px] font-medium text-text dark:text-text-dark">
                {t("items.addDate")}
              </span>
              <span className="text-xs text-muted dark:text-muted-dark">
                {t("items.manualAdd")}
              </span>
            </div>
          ) : info.daysRemaining === null ? (
            <div className="mt-3 num text-3xl font-semibold leading-none">—</div>
          ) : info.daysRemaining < 0 ? (
            <div className="mt-3 flex items-baseline gap-2">
              <span
                className={cn(
                  "text-2xl font-semibold tracking-tight",
                  statusTextClass(info.status),
                )}
              >
                {t("items.expired")}
              </span>
            </div>
          ) : (
            <div
              className={cn(
                "mt-3 flex items-baseline gap-1.5",
                statusTextClass(info.status),
              )}
            >
              <span className="num text-[44px] font-semibold leading-none tracking-tight">
                {info.daysRemaining}
              </span>
              <span className="text-[11px] font-medium opacity-80">
                {t("items.daysLeft")}
              </span>
            </div>
          )}

          {/* Footer: ISO date, or a small "X days ago" for expired */}
          {item?.expiresOn && info.status !== "unset" && (
            <div className="mt-2 num text-[11px] text-muted dark:text-muted-dark">
              {item.expiresOn}
            </div>
          )}
          {info.status === "expired" && info.daysRemaining !== null && (
            <div className="mt-1 num text-[11px] text-danger/80">
              {Math.abs(info.daysRemaining)} {t("items.daysLeft").split(" ")[0]}
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  );
}

function StatusIcon({ status }: { status: Status }) {
  const C = (() => {
    switch (status) {
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
  return (
    <C
      className={cn(
        "h-4 w-4 opacity-80",
        status === "unset"
          ? "text-muted dark:text-muted-dark"
          : statusTextClass(status),
      )}
    />
  );
}

function statusTextClass(status: Status): string {
  switch (status) {
    case "ok":
      return "text-success";
    case "soon":
      return "text-warning";
    case "danger":
    case "expired":
      return "text-danger";
    case "unset":
      return "text-muted dark:text-muted-dark";
  }
}

function describeStatus(
  status: Status,
  days: number | null,
  t: (k: string) => string,
): string {
  if (status === "unset") return t("items.addDate");
  if (days === null) return "—";
  if (days < 0) return t("items.expired");
  return `${days} ${t("items.daysLeft")}`;
}
