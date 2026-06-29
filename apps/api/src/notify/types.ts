export interface DueNotification {
  userId: string;
  itemKind: "dated" | "maintenance";
  itemId: string;
  bikeId: string;
  itemType: "sigorta" | "kasko" | "muayene" | "maintenance" | "mtv";
  leadDays: number;
  expiresOn: string;
  bikeNickname: string;
  bikePlate: string | null;
  maintenanceLabel: string | null;
}
