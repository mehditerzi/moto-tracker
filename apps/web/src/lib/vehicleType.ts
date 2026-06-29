import { Bike, Car, type LucideIcon } from "lucide-react";
import type { VehicleType } from "@mototracker/shared";

/**
 * The lucide icon for a vehicle type. Cars get the car glyph, everything else
 * (motorcycles, or an unknown/null type) falls back to the bike glyph — the
 * app's original default. Centralized here so every surface that shows a vehicle
 * (dashboard hero, switcher, list rows) stays consistent.
 */
export function vehicleIcon(type: VehicleType | null | undefined): LucideIcon {
  return type === "car" ? Car : Bike;
}
