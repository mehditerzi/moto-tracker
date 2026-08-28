import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/**
 * "Şirket aracı · Kervan Filo" — the persistent marker on an organization's
 * vehicle.
 *
 * NON-DISMISSIBLE BY DESIGN. A driver must never be unsure which garage they are
 * in, because the answer decides whether the routes they record are visible to
 * their employer. It therefore rides on the vehicle itself — the dashboard
 * header and every switcher pill — rather than being a banner that can be
 * closed and forgotten.
 *
 * It names the organization rather than saying "company vehicle" generically:
 * a courier who drives for two firms needs to know which one.
 */
export function OrgVehicleBadge({
  orgName,
  size = "md",
  className,
}: {
  orgName: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-strong/60 bg-surface-elev px-2 py-0.5 text-muted dark:border-border-strong-dark/60 dark:bg-surface-elev-dark dark:text-muted-dark",
        size === "sm" ? "text-[10px]" : "text-[11px]",
        className,
      )}
      title={t("fleet.orgVehicle.tooltip", { org: orgName })}
    >
      <Building2 className={size === "sm" ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} strokeWidth={2} aria-hidden />
      <span className="truncate font-medium">
        {t("fleet.orgVehicle.label")} · {orgName}
      </span>
    </span>
  );
}
