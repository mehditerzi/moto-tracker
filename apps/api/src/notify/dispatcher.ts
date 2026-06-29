import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { sendPush } from "./webPushClient.js";
import { sendApns, apnsConfigured } from "./apns.js";
import { computeDueNotifications } from "./computeDueNotifications.js";
import type { DueNotification } from "./types.js";

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface DispatchSummary {
  total: number;
  sent: number;
  recordedSent: number;
  expiredEndpoints: number;
}

const TYPE_LABEL: Record<string, string> = {
  sigorta: "Sigorta",
  kasko: "Kasko",
  muayene: "Muayene",
  maintenance: "Bakım",
  mtv: "MTV",
};

function buildPayload(n: DueNotification) {
  const label =
    n.itemKind === "maintenance" && n.maintenanceLabel
      ? n.maintenanceLabel
      : TYPE_LABEL[n.itemType] ?? "Bildirim";
  const days = n.leadDays;
  const subject = days === 0 ? "bugün" : `${days} gün sonra`;
  const url =
    n.itemKind === "dated"
      ? `/dated-items/${n.itemId}`
      : `/bikes/${n.bikeId}/maintenance/${n.itemId}`;
  return {
    title: `${label} ${subject} bitiyor`,
    body: `${n.bikeNickname}${n.bikePlate ? ` · ${n.bikePlate}` : ""}`,
    url,
    tag: `${n.itemKind}:${n.itemId}:${n.leadDays}`,
  };
}

export async function dispatchForToday(todayIso: string): Promise<DispatchSummary> {
  const db = getDb();
  const due = computeDueNotifications(db, todayIso);

  let sent = 0;
  let recordedSent = 0;
  let expiredEndpoints = 0;

  for (const n of due) {
    const subs = db
      .prepare("SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE user_id = ?")
      .all(n.userId) as SubRow[];

    const payload = buildPayload(n);
    let anyOk = false;
    for (const s of subs) {
      const res = await sendPush({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
        payload,
      });
      if (res.ok) {
        anyOk = true;
        sent += 1;
      } else if (res.gone) {
        db.prepare("DELETE FROM push_subscription WHERE id = ?").run(s.id);
        expiredEndpoints += 1;
      }
    }

    // Native push (APNs) to the user's iOS devices — no-op unless configured.
    if (apnsConfigured()) {
      const tokens = db
        .prepare("SELECT id, token FROM device_token WHERE user_id = ? AND platform = 'ios'")
        .all(n.userId) as { id: string; token: string }[];
      for (const d of tokens) {
        const res = await sendApns(d.token, { title: payload.title, body: payload.body, url: payload.url });
        if (res.ok) {
          anyOk = true;
          sent += 1;
        } else if (res.gone) {
          db.prepare("DELETE FROM device_token WHERE id = ?").run(d.id);
          expiredEndpoints += 1;
        }
      }
    }

    if (anyOk) {
      db.prepare(
        `INSERT OR IGNORE INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(newId(), n.userId, n.itemKind, n.itemId, n.leadDays, todayIso);
      recordedSent += 1;
    }
  }

  return { total: due.length, sent, recordedSent, expiredEndpoints };
}
