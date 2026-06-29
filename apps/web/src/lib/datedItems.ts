import { differenceInCalendarDays, parseISO } from "date-fns";
import type { DatedItemType } from "@mototracker/shared";

export type Status = "ok" | "soon" | "danger" | "expired" | "unset";

export interface StatusInfo {
  status: Status;
  daysRemaining: number | null;
}

export function statusFor(expiresOn: string | null | undefined, today = new Date()): StatusInfo {
  if (!expiresOn) return { status: "unset", daysRemaining: null };
  const target = parseISO(expiresOn);
  const days = differenceInCalendarDays(target, today);
  if (days < 0) return { status: "expired", daysRemaining: days };
  if (days <= 7) return { status: "danger", daysRemaining: days };
  if (days <= 30) return { status: "soon", daysRemaining: days };
  return { status: "ok", daysRemaining: days };
}

export const TYPE_ORDER: DatedItemType[] = ["muayene", "sigorta", "kasko", "mtv"];

export function statusColorClass(status: Status): string {
  switch (status) {
    case "ok":
      return "text-success border-success/40 bg-success/10";
    case "soon":
      return "text-warning border-warning/50 bg-warning/10";
    case "danger":
    case "expired":
      return "text-danger border-danger/50 bg-danger/10";
    case "unset":
      return "text-muted dark:text-muted-dark border-border bg-surface/80 dark:border-border-dark dark:bg-surface-elev-dark";
  }
}

export function statusRingClass(status: Status): string {
  switch (status) {
    case "ok":
      return "ring-2 ring-success/30";
    case "soon":
      return "ring-2 ring-warning/40";
    case "danger":
    case "expired":
      return "ring-2 ring-danger/50";
    case "unset":
      return "ring-1 ring-border dark:ring-border-dark";
  }
}

export function statusDotClass(status: Status): string {
  switch (status) {
    case "ok":
      return "bg-success";
    case "soon":
      return "bg-warning";
    case "danger":
    case "expired":
      return "bg-danger";
    case "unset":
      return "bg-muted/40 dark:bg-muted-dark/40";
  }
}
