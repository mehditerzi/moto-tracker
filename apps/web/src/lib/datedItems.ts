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

export const TYPE_LABEL_TR: Record<DatedItemType, string> = {
  sigorta: "Sigorta",
  kasko: "Kasko",
  muayene: "Muayene",
};

export const TYPE_LABEL_EN: Record<DatedItemType, string> = {
  sigorta: "Insurance",
  kasko: "Kasko",
  muayene: "Inspection",
};

export const TYPE_ORDER: DatedItemType[] = ["muayene", "sigorta", "kasko"];

export function statusColorClass(status: Status): string {
  switch (status) {
    case "ok":
      return "text-success border-success/40 bg-success/10";
    case "soon":
      return "text-warning border-warning/40 bg-warning/10";
    case "danger":
    case "expired":
      return "text-danger border-danger/40 bg-danger/10";
    case "unset":
      return "text-muted border-border bg-surface dark:border-border-dark dark:bg-surface-elev-dark";
  }
}

export function statusRingClass(status: Status): string {
  switch (status) {
    case "ok":
      return "ring-2 ring-success/30";
    case "soon":
      return "ring-2 ring-warning/30";
    case "danger":
    case "expired":
      return "ring-2 ring-danger/40";
    case "unset":
      return "ring-1 ring-border dark:ring-border-dark";
  }
}
