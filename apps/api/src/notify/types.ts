import type { Lang } from "./messages.js";

export interface DueNotification {
  /**
   * The RECIPIENT — not necessarily the person who typed the record. On an org
   * vehicle one item fans out to the management line plus the driver holding
   * it, so the same (itemKind, itemId, leadDays) appears once per recipient.
   */
  userId: string;
  /** Recipient's profile.language, 'tr' when they have no profile row. */
  language: Lang;
  itemKind: "dated" | "maintenance";
  itemId: string;
  bikeId: string;
  /** The vehicle's organization; null for a personal vehicle. */
  orgId: string | null;
  itemType: "sigorta" | "kasko" | "muayene" | "maintenance" | "mtv";
  leadDays: number;
  expiresOn: string;
  bikeNickname: string;
  bikePlate: string | null;
  /** maintenance_item.kind ('engine_oil', 'custom', …); null for dated items. */
  maintenanceKind: string | null;
  /** Only set for kind='custom' — the user's own words, never translated. */
  maintenanceLabel: string | null;
}
