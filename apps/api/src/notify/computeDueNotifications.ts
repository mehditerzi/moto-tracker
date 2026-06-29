import type Database from "better-sqlite3";
import { addDays, addMonths, parseISO, format, isBefore } from "date-fns";
import type { DueNotification } from "./types.js";

interface PrefRow {
  user_id: string;
  item_type: "sigorta" | "kasko" | "muayene" | "maintenance" | "mtv";
  lead_days_csv: string;
  enabled: number;
}

interface DatedItemRow {
  id: string;
  bike_id: string;
  user_id: string;
  type: "sigorta" | "kasko" | "muayene" | "mtv";
  expires_on: string;
}

interface MaintRow {
  id: string;
  bike_id: string;
  user_id: string;
  kind: string;
  custom_label: string | null;
  last_done_on: string | null;
  last_done_km: number | null;
  interval_months: number | null;
  interval_km: number | null;
}

interface BikeRow {
  id: string;
  nickname: string;
  plate: string | null;
  current_km: number | null;
}

interface SentRow {
  item_kind: "dated" | "maintenance";
  item_id: string;
  lead_days: number;
}

function parseLeads(csv: string): number[] {
  return csv
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function maintenanceDueDate(m: MaintRow): string | null {
  if (!m.last_done_on || !m.interval_months) return null;
  const base = parseISO(m.last_done_on);
  const due = addMonths(base, m.interval_months);
  return format(due, "yyyy-MM-dd");
}

const MAINT_LABEL: Record<string, string> = {
  engine_oil: "Motor yağı",
  brakes: "Fren",
  tires: "Lastik",
  battery: "Akü",
  coolant: "Soğutma",
  air_filter: "Hava filtresi",
  chain: "Zincir",
  custom: "Bakım",
};

export function computeDueNotifications(db: Database.Database, todayIso: string): DueNotification[] {
  const today = parseISO(todayIso);
  const prefs = db
    .prepare("SELECT user_id, item_type, lead_days_csv, enabled FROM notification_preference")
    .all() as PrefRow[];

  const sentRows = db
    .prepare(
      "SELECT item_kind, item_id, lead_days FROM notification_sent WHERE sent_on = ?",
    )
    .all(todayIso) as SentRow[];
  const sentKey = new Set(sentRows.map((r) => `${r.item_kind}:${r.item_id}:${r.lead_days}`));

  const out: DueNotification[] = [];

  const dated = db
    .prepare(
      `SELECT di.id, di.bike_id, di.user_id, di.type, di.expires_on
         FROM dated_item di
         JOIN (
           SELECT bike_id, type, MAX(expires_on) AS me
             FROM dated_item GROUP BY bike_id, type
         ) m ON m.bike_id = di.bike_id AND m.type = di.type AND m.me = di.expires_on`,
    )
    .all() as DatedItemRow[];

  const bikeStmt = db.prepare(
    "SELECT id, nickname, plate, current_km FROM bike WHERE id = ? AND archived = 0",
  );

  for (const d of dated) {
    const pref = prefs.find((p) => p.user_id === d.user_id && p.item_type === d.type);
    if (!pref || pref.enabled !== 1) continue;
    const leads = parseLeads(pref.lead_days_csv);
    const target = parseISO(d.expires_on);
    if (isBefore(target, today)) continue;

    for (const lead of leads) {
      const fireDay = addDays(target, -lead);
      if (format(fireDay, "yyyy-MM-dd") !== todayIso) continue;
      if (sentKey.has(`dated:${d.id}:${lead}`)) continue;
      const bike = bikeStmt.get(d.bike_id) as BikeRow | undefined;
      if (!bike) continue;
      out.push({
        userId: d.user_id,
        itemKind: "dated",
        itemId: d.id,
        bikeId: d.bike_id,
        itemType: d.type,
        leadDays: lead,
        expiresOn: d.expires_on,
        bikeNickname: bike.nickname,
        bikePlate: bike.plate,
        maintenanceLabel: null,
      });
    }
  }

  const maint = db
    .prepare(
      "SELECT id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km, interval_months, interval_km FROM maintenance_item",
    )
    .all() as MaintRow[];

  for (const m of maint) {
    const pref = prefs.find((p) => p.user_id === m.user_id && p.item_type === "maintenance");
    if (!pref || pref.enabled !== 1) continue;
    const due = maintenanceDueDate(m);
    if (!due) continue;
    const target = parseISO(due);
    if (isBefore(target, today)) continue;
    const leads = parseLeads(pref.lead_days_csv);
    for (const lead of leads) {
      const fireDay = addDays(target, -lead);
      if (format(fireDay, "yyyy-MM-dd") !== todayIso) continue;
      if (sentKey.has(`maintenance:${m.id}:${lead}`)) continue;
      const bike = bikeStmt.get(m.bike_id) as BikeRow | undefined;
      if (!bike) continue;
      out.push({
        userId: m.user_id,
        itemKind: "maintenance",
        itemId: m.id,
        bikeId: m.bike_id,
        itemType: "maintenance",
        leadDays: lead,
        expiresOn: due,
        bikeNickname: bike.nickname,
        bikePlate: bike.plate,
        maintenanceLabel: m.kind === "custom" ? m.custom_label ?? "Bakım" : MAINT_LABEL[m.kind] ?? "Bakım",
      });
    }
  }

  return out;
}
