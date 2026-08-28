import { AlertTriangle, CheckCircle2, Clock, CircleDashed, User, Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FleetDueKind, FleetHolder, FleetStatus } from "@mototracker/shared";
import { statusDotClass, statusColorClass } from "@/lib/datedItems";
import { cn } from "@/lib/cn";

/**
 * The small pieces every fleet screen is built from.
 *
 * All of them are deliberately thin wrappers over the consumer app's own
 * vocabulary (`statusDotClass`, the `num` tabular treatment, the `label-micro`
 * caps) rather than a second visual language: a manager who also uses the
 * consumer app has to be able to read a fleet row without relearning anything
 * (docs/fleet-design.md §6).
 */

// ─── status ───────────────────────────────────────────────────────────────────

const STATUS_ICON = {
  ok: CheckCircle2,
  soon: Clock,
  danger: AlertTriangle,
  expired: AlertTriangle,
  unset: CircleDashed,
} as const;

/**
 * Status as a chip. Colour is never the only carrier — there is always an icon
 * AND a word, which is the §8 requirement and also what makes the board legible
 * in a sunlit van.
 */
export function StatusBadge({ status, className }: { status: FleetStatus; className?: string }) {
  const { t } = useTranslation();
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        statusColorClass(status),
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
      {t(`fleet.status.${status}`)}
    </span>
  );
}

/** The 3px LED rail down the left of a card / row. Decorative only. */
export function StatusRail({ status }: { status: FleetStatus }) {
  return (
    <span
      aria-hidden
      className={cn("absolute inset-y-2 left-0 w-[3px] rounded-full", statusDotClass(status))}
    />
  );
}

export function statusTextClass(status: FleetStatus): string {
  switch (status) {
    case "ok":
      return "text-success";
    case "soon":
      return "text-warning";
    case "danger":
    case "expired":
      return "text-danger";
    default:
      return "text-muted dark:text-muted-dark";
  }
}

// ─── numerals ─────────────────────────────────────────────────────────────────

/** A plate, always mono and always spaced as it was stored. */
export function Plate({ plate, className }: { plate: string | null; className?: string }) {
  const { t } = useTranslation();
  if (!plate) {
    return <span className={cn("text-muted dark:text-muted-dark", className)}>{t("common.dash")}</span>;
  }
  return (
    <span className={cn("num text-[13px] font-medium uppercase tracking-wider", className)}>
      {plate}
    </span>
  );
}

/**
 * Days remaining, signed. Overdue reads "12 days ago" rather than "-12", because
 * a minus sign in a column of dates is easy to skim past and being late is the
 * one thing on this screen that must not be skimmed past.
 */
export function DaysRemaining({ days, status }: { days: number; status: FleetStatus }) {
  const { t } = useTranslation();
  const overdue = days < 0;
  return (
    <span className={cn("num text-[13px] font-semibold tabular-nums", statusTextClass(status))}>
      {overdue
        ? t("fleet.daysOverdue", { count: Math.abs(days) })
        : t("fleet.daysLeft", { count: days })}
    </span>
  );
}

/** A ₺ amount. `null` renders as an em dash — never as 0. */
export function Money({ value, currency = "TRY" }: { value: number | null; currency?: string }) {
  const { i18n, t } = useTranslation();
  if (value === null) {
    return <span className="text-muted dark:text-muted-dark">{t("common.dash")}</span>;
  }
  return (
    <span className="num tabular-nums">
      {new Intl.NumberFormat(i18n.language === "tr" ? "tr-TR" : "en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value)}
    </span>
  );
}

export function Km({ value }: { value: number | null }) {
  const { i18n, t } = useTranslation();
  if (value === null) {
    return <span className="text-muted dark:text-muted-dark">{t("common.dash")}</span>;
  }
  return (
    <span className="num tabular-nums">
      {new Intl.NumberFormat(i18n.language === "tr" ? "tr-TR" : "en-US").format(value)}
      <span className="ml-1 text-[11px] text-muted dark:text-muted-dark">km</span>
    </span>
  );
}

// ─── vocabulary ───────────────────────────────────────────────────────────────

/** What is expiring. The four dated types keep the consumer app's own labels. */
export function DueKindLabel({ kind, label }: { kind: FleetDueKind; label: string | null }) {
  const { t } = useTranslation();
  if (kind === "maintenance") {
    return <>{label ? t(`maintenance.kinds.${label}`, { defaultValue: label }) : t("fleet.kinds.maintenance")}</>;
  }
  if (kind === "contract_due") return <>{t("fleet.kinds.contract_due")}</>;
  return <>{t(`items.${kind}`)}</>;
}

/**
 * Who has the vehicle. ONE cell for both modes — a driver in fleet mode, a
 * customer in rental mode — because the design doc is explicit that there is one
 * vehicle row, not two parallel UIs (§4).
 */
export function HolderCell({ holder }: { holder: FleetHolder | null }) {
  const { t } = useTranslation();
  if (!holder) {
    return (
      <span className="text-[13px] text-muted dark:text-muted-dark">{t("fleet.holder.idle")}</span>
    );
  }
  const Icon = holder.type === "driver" ? User : Building2;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px]">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted dark:text-muted-dark" strokeWidth={1.8} aria-hidden />
      <span className="truncate">{holder.name}</span>
      <span className="sr-only">
        {holder.type === "driver" ? t("fleet.holder.driver") : t("fleet.holder.customer")}
      </span>
    </span>
  );
}

// ─── layout helpers ───────────────────────────────────────────────────────────

export function SectionHeading({
  id,
  title,
  count,
  tone = "default",
  children,
}: {
  /** Set when a `<section aria-labelledby>` points at this heading. */
  id?: string;
  title: string;
  count?: number;
  tone?: "default" | "danger";
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 id={id} className="flex items-center gap-2">
        <span
          className={cn(
            "label-micro",
            tone === "danger" ? "text-danger" : "text-muted dark:text-muted-dark",
          )}
        >
          {title}
        </span>
        {count !== undefined && (
          <span
            className={cn(
              "num rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
              tone === "danger"
                ? "bg-danger/10 text-danger"
                : "bg-surface-elev text-muted dark:bg-surface-elev-dark dark:text-muted-dark",
            )}
          >
            {count}
          </span>
        )}
      </h2>
      {children}
    </div>
  );
}

/** One figure in the fleet summary strip. */
export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "danger" | "warning";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface/70 px-3 py-2.5 dark:border-border-dark dark:bg-surface-dark/60">
      <span
        className={cn(
          "num text-[22px] font-semibold leading-none",
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] leading-tight text-muted dark:text-muted-dark">{label}</span>
    </div>
  );
}
