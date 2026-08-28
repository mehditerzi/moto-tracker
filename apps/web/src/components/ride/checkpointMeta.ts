import { Flag, Fuel, Mountain, UtensilsCrossed, Users, type LucideIcon } from "lucide-react";
import type { CheckpointKind } from "@mototracker/shared";

/**
 * A checkpoint's kind is the fastest thing on the screen to read: at a glance,
 * from a tank bag, the icon says "fuel" long before the name says "Shell
 * Kavacık". Every kind therefore has an icon *and* a word — never colour alone,
 * and never an icon alone.
 */
export const CHECKPOINT_META: Record<CheckpointKind, { icon: LucideIcon; labelKey: string }> = {
  stop: { icon: Flag, labelKey: "map.kinds.stop" },
  fuel: { icon: Fuel, labelKey: "map.kinds.fuel" },
  food: { icon: UtensilsCrossed, labelKey: "map.kinds.food" },
  view: { icon: Mountain, labelKey: "map.kinds.view" },
  regroup: { icon: Users, labelKey: "map.kinds.regroup" },
};

/**
 * Order the kind chips appear in. `stop` first because it is the default and
 * the one-tap path; the rest are the reasons a group actually pulls over.
 */
export const CHECKPOINT_KIND_ORDER: readonly CheckpointKind[] = [
  "stop",
  "fuel",
  "food",
  "view",
  "regroup",
];
