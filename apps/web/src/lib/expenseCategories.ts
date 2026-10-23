import {
  Wrench,
  Cog,
  Disc3,
  Droplets,
  SquareParking,
  Milestone,
  Siren,
  Landmark,
  ShieldCheck,
  Package,
  Ellipsis,
  Fuel,
  type LucideIcon,
} from "lucide-react";
import type { ExpenseCategory } from "@mototracker/shared";

/** One icon per category, so a list of costs can be read at a glance. */
export const EXPENSE_ICON: Record<ExpenseCategory, LucideIcon> = {
  repair: Wrench,
  parts: Cog,
  tires: Disc3,
  wash: Droplets,
  parking: SquareParking,
  toll: Milestone,
  fine: Siren,
  tax: Landmark,
  insurance: ShieldCheck,
  accessory: Package,
  other: Ellipsis,
};

/** The order the quick-add grid offers them in: most frequent first. */
export const QUICK_CATEGORIES: ExpenseCategory[] = [
  "parking",
  "toll",
  "wash",
  "repair",
  "parts",
  "tires",
  "fine",
  "tax",
  "accessory",
  "other",
];

/** Colours for the four cost sources, shared by the bar and its legend. */
export const SOURCE_COLOR = {
  fuel: "bg-accent",
  maintenance: "bg-sky-400",
  document: "bg-violet-400",
  expense: "bg-amber-400",
} as const;

export const SOURCE_ICON = { fuel: Fuel, maintenance: Wrench, document: ShieldCheck, expense: Package } as const;
