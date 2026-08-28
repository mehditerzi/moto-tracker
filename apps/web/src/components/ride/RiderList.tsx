import { useTranslation } from "react-i18next";
import { Crown, Flag } from "lucide-react";
import type { RiderRow } from "@/hooks/useRideRoster";

/**
 * Who is where, and who has fallen behind — the two questions a group ride is
 * run on, in reading order: the leader, then the field, then the sweep.
 *
 * Status is never colour alone. Every row spells out what it means, because the
 * one genuinely dangerous thing a group-ride map can do is let a fix from four
 * minutes ago read as "he's right there".
 */
export function RiderList({ riders }: { riders: RiderRow[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1">
      {riders.map((r) => (
        <li
          key={r.userId}
          className={`flex items-center gap-3 rounded-xl px-2 py-2 ${
            r.isSweep ? "bg-warning/10 ring-1 ring-warning/30" : ""
          }`}
        >
          <span
            aria-hidden
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold ${dotClass(r)}`}
          >
            {r.name.slice(0, 1).toLocaleUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-medium">{r.name}</span>
              {r.isLeader && (
                <Badge icon={<Crown className="h-3 w-3" strokeWidth={2.2} />} tone="accent">
                  {t("map.leader")}
                </Badge>
              )}
              {r.isSweep && (
                <Badge icon={<Flag className="h-3 w-3" strokeWidth={2.2} />} tone="warning">
                  {t("map.sweep")}
                </Badge>
              )}
              {r.isSelf && <Badge tone="muted">{t("map.you")}</Badge>}
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-muted dark:text-muted-dark">
              {statusLine(r, t)}
            </span>
          </span>
          {r.gapKm != null && r.gapKm >= 0.1 && (
            <span className="shrink-0 text-right">
              <span className="num block text-[17px] font-semibold leading-none">
                {formatKm(r.gapKm)}
              </span>
              <span className="num mt-1 block text-[12px] leading-none text-muted dark:text-muted-dark">
                {t("map.minShort", { count: r.gapMin ?? 0 })}
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Under 10 km one decimal is information; over it, it is noise on a moving bike. */
export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

function dotClass(r: RiderRow): string {
  if (r.status === "moving") return "bg-success/15 text-success";
  if (r.status === "stopped") return "bg-warning/15 text-warning";
  return "bg-surface-elev text-muted dark:bg-surface-dark dark:text-muted-dark";
}

function statusLine(
  r: RiderRow,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (r.status === "offline") return t("map.noFix");
  if (r.status === "stale") {
    return r.ageMin < 1 ? t("map.lastSeenRecent") : t("map.lastSeen", { count: r.ageMin });
  }
  const motion =
    r.status === "stopped"
      ? t("map.stopped")
      : r.speedKmh != null
        ? t("map.movingAt", { kmh: Math.round(r.speedKmh) })
        : t("map.moving");
  if (r.isLeader) return `${motion} · ${t("map.leadingGroup")}`;
  if (r.gapKm == null) return motion;
  return `${motion} · ${r.alongRoute ? t("map.behindOnRoute") : t("map.behindDirect")}`;
}

function Badge({
  children,
  icon,
  tone,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone: "accent" | "warning" | "muted";
}) {
  const tones = {
    accent: "bg-accent/15 text-accent-dim ring-accent/30 dark:text-accent",
    warning: "bg-warning/15 text-warning ring-warning/30",
    muted: "bg-surface-elev text-muted ring-border dark:bg-surface-dark dark:text-muted-dark dark:ring-border-dark",
  } as const;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
