import { Router } from "express";
import { z } from "zod";
import {
  rideEventInputSchema,
  rsvpInputSchema,
  type RideEvent,
  type RideEventRider,
  type RsvpStatus,
} from "@mototracker/shared";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { config } from "../config.js";
import { liveRideCode, newCode, openRideGroup } from "./rideGroups.js";
import { fireAndForget } from "../notify/events.js";
import { pushToUser, Semaphore, PUSH_CONCURRENCY } from "../notify/send.js";
import { asLang, DEFAULT_LANG, type Lang } from "../notify/messages.js";

/**
 * Planned group rides. The organiser creates one, shares the link
 * (/r/<code>), friends say "going" or "maybe", and on the day the organiser
 * opens the live map room from it — everybody who said yes gets a push with
 * the join code.
 *
 * Visibility is the invite link: anyone signed in who has the code can see the
 * ride and the first names of who is coming. There is no public directory.
 */
export const rideEventsRouter: Router = Router();
rideEventsRouter.use(requireUser);

/** How many future rides one person may organise at once. */
export const MAX_OPEN_EVENTS = 20;
/** A ride stays "upcoming" for this long after its start (people are riding). */
const STILL_ON_HOURS = 12;

interface EventRow {
  id: string;
  owner_id: string;
  code: string;
  title: string;
  note: string | null;
  starts_at: string;
  meet_name: string;
  meet_lat: number | null;
  meet_lng: number | null;
  dest_name: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  distance_km: number | null;
  pace: string;
  vehicle_kind: string;
  max_riders: number | null;
  live_group_id: string | null;
  reminded_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

function nameOf(userId: string): string {
  const u = getDb()
    .prepare("SELECT name, email FROM user WHERE id = ?")
    .get(userId) as { name: string | null; email: string } | undefined;
  return firstName(u?.name, u?.email);
}

/**
 * Other riders see a first name, never an email address: an invite link gets
 * forwarded to WhatsApp groups, and the people on a ride did not agree to
 * publish their login to everyone who holds it.
 */
function firstName(name: string | null | undefined, email: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (n) {
    const parts = n.split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]}.` : parts[0]!;
  }
  const local = (email ?? "").split("@")[0] ?? "";
  return local ? local.slice(0, 1).toUpperCase() + local.slice(1, 3) + "…" : "?";
}

function riders(ev: EventRow): RideEventRider[] {
  const rows = getDb()
    .prepare(
      `SELECT r.user_id, r.status, u.name, u.email, b.make, b.model, b.nickname
         FROM ride_event_rsvp r
         JOIN user u ON u.id = r.user_id
         LEFT JOIN bike b ON b.id = r.bike_id
        WHERE r.event_id = ?
        ORDER BY r.status = 'going' DESC, r.created_at`,
    )
    .all(ev.id) as Array<{
    user_id: string;
    status: RsvpStatus;
    name: string | null;
    email: string;
    make: string | null;
    model: string | null;
    nickname: string | null;
  }>;
  const list: RideEventRider[] = rows.map((r) => ({
    userId: r.user_id,
    name: firstName(r.name, r.email),
    status: r.status,
    isOwner: r.user_id === ev.owner_id,
    vehicle: [r.make, r.model].filter(Boolean).join(" ") || r.nickname || null,
  }));
  // The organiser leads the list.
  return list.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
}

function toJson(ev: EventRow, userId: string): RideEvent {
  const list = riders(ev);
  const mine = list.find((r) => r.userId === userId);
  return {
    id: ev.id,
    code: ev.code,
    title: ev.title,
    note: ev.note,
    startsAt: ev.starts_at,
    meet: { name: ev.meet_name, lat: ev.meet_lat, lng: ev.meet_lng },
    destination: ev.dest_name ? { name: ev.dest_name, lat: ev.dest_lat, lng: ev.dest_lng } : null,
    distanceKm: ev.distance_km,
    pace: ev.pace as RideEvent["pace"],
    vehicleKind: ev.vehicle_kind as RideEvent["vehicleKind"],
    maxRiders: ev.max_riders,
    ownerId: ev.owner_id,
    ownerName: nameOf(ev.owner_id),
    isOwner: ev.owner_id === userId,
    myStatus: mine?.status ?? null,
    goingCount: list.filter((r) => r.status === "going").length,
    maybeCount: list.filter((r) => r.status === "maybe").length,
    riders: list,
    cancelled: ev.cancelled_at !== null,
    liveCode: ev.cancelled_at ? null : liveRideCode(ev.live_group_id),
    createdAt: ev.created_at,
  };
}

function byCode(code: string): EventRow | undefined {
  return getDb()
    .prepare("SELECT * FROM ride_event WHERE code = ?")
    .get(code.trim().toUpperCase()) as EventRow | undefined;
}

function byId(id: string): EventRow | undefined {
  return getDb().prepare("SELECT * FROM ride_event WHERE id = ?").get(id) as EventRow | undefined;
}

function ownedBy(id: string, userId: string): EventRow | null {
  const ev = byId(id);
  return ev && ev.owner_id === userId ? ev : null;
}

/** A start time must be ahead of us, but not absurdly far. */
function checkStart(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "invalid_start";
  if (t < Date.now() - 5 * 60_000) return "start_in_past";
  if (t > Date.now() + 366 * 86_400_000) return "start_too_far";
  return null;
}

function ownsBike(userId: string, bikeId: string): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM bike WHERE id = ? AND user_id = ? AND archived = 0")
    .get(bikeId, userId);
}

// ─── notifications ───────────────────────────────────────────────────────────

const sem = new Semaphore(PUSH_CONCURRENCY);

function langOf(userId: string): Lang {
  const row = getDb().prepare("SELECT language FROM profile WHERE user_id = ?").get(userId) as
    | { language: string }
    | undefined;
  return row ? asLang(row.language) : DEFAULT_LANG;
}

function whenText(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "tr-TR", {
    timeZone: config.CRON_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Everybody on the ride except `except` (usually the person who acted). */
function audience(ev: EventRow, except: string | null): string[] {
  const ids = (
    getDb().prepare("SELECT user_id FROM ride_event_rsvp WHERE event_id = ?").all(ev.id) as {
      user_id: string;
    }[]
  ).map((r) => r.user_id);
  return [...new Set([ev.owner_id, ...ids])].filter((id) => id !== except);
}

function notify(
  userIds: string[],
  tag: string,
  url: string,
  build: (lang: Lang) => { title: string; body: string },
): void {
  if (userIds.length === 0) return;
  fireAndForget(async () => {
    await Promise.all(
      userIds.map((id) => pushToUser(id, { ...build(langOf(id)), url, tag }, sem)),
    );
  });
}

/**
 * The hour-before reminder. Called from cron every few minutes; `reminded_at`
 * is claimed in the same UPDATE that selects the row, so overlapping ticks or
 * two processes cannot remind twice.
 */
export function remindUpcomingRides(): number {
  const db = getDb();
  const soon = new Date(Date.now() + 65 * 60_000).toISOString();
  const now = new Date().toISOString();
  const due = db
    .prepare(
      `SELECT * FROM ride_event
        WHERE cancelled_at IS NULL AND reminded_at IS NULL
          AND starts_at > ? AND starts_at <= ?`,
    )
    .all(now, soon) as EventRow[];
  let n = 0;
  for (const ev of due) {
    const claimed = db
      .prepare("UPDATE ride_event SET reminded_at = datetime('now') WHERE id = ? AND reminded_at IS NULL")
      .run(ev.id);
    if (claimed.changes === 0) continue;
    n++;
    const going = (
      db
        .prepare("SELECT user_id FROM ride_event_rsvp WHERE event_id = ? AND status = 'going'")
        .all(ev.id) as { user_id: string }[]
    ).map((r) => r.user_id);
    notify([...new Set([ev.owner_id, ...going])], `ride-${ev.id}`, `/rides/${ev.code}`, (lang) =>
      lang === "en"
        ? { title: `${ev.title} starts in an hour`, body: `Meet at ${ev.meet_name}.` }
        : { title: `${ev.title} bir saat sonra`, body: `Buluşma: ${ev.meet_name}.` },
    );
  }
  return n;
}

// ─── routes ──────────────────────────────────────────────────────────────────

rideEventsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT e.* FROM ride_event e
           LEFT JOIN ride_event_rsvp r ON r.event_id = e.id AND r.user_id = ?
          WHERE e.owner_id = ? OR r.user_id IS NOT NULL
          ORDER BY e.starts_at`,
      )
      .all(userId, userId) as EventRow[];
    const cutoff = Date.now() - STILL_ON_HOURS * 3_600_000;
    const upcoming = rows.filter((e) => Date.parse(e.starts_at) >= cutoff && !e.cancelled_at);
    const past = rows
      .filter((e) => Date.parse(e.starts_at) < cutoff || e.cancelled_at)
      .reverse()
      .slice(0, 20);
    res.json({
      upcoming: upcoming.map((e) => toJson(e, userId)),
      past: past.map((e) => toJson(e, userId)),
    });
  }),
);

rideEventsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const input = rideEventInputSchema.parse(req.body);
    const bad = checkStart(input.startsAt);
    if (bad) {
      res.status(400).json({ error: bad });
      return;
    }
    const db = getDb();
    const open = db
      .prepare(
        "SELECT COUNT(*) AS n FROM ride_event WHERE owner_id = ? AND cancelled_at IS NULL AND starts_at > ?",
      )
      .get(userId, new Date().toISOString()) as { n: number };
    if (open.n >= MAX_OPEN_EVENTS) {
      res.status(409).json({ error: "too_many_rides" });
      return;
    }
    const id = newId();
    const startsAt = new Date(input.startsAt).toISOString();
    const insert = db.prepare(
      `INSERT INTO ride_event (id, owner_id, code, title, note, starts_at, meet_name, meet_lat, meet_lng,
         dest_name, dest_lat, dest_lng, distance_km, pace, vehicle_kind, max_riders)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (let attempt = 0; ; attempt++) {
        try {
          insert.run(
            id,
            userId,
            newCode(),
            input.title,
            input.note || null,
            startsAt,
            input.meet.name,
            input.meet.lat ?? null,
            input.meet.lng ?? null,
            input.destination?.name ?? null,
            input.destination?.lat ?? null,
            input.destination?.lng ?? null,
            input.distanceKm ?? null,
            input.pace,
            input.vehicleKind,
            input.maxRiders ?? null,
          );
          break;
        } catch (err) {
          const e = err as { code?: string; message?: string };
          if (attempt < 5 && e.code === "SQLITE_CONSTRAINT_UNIQUE" && /ride_event\.code/.test(e.message ?? "")) continue;
          throw err;
        }
      }
      // The organiser is on their own ride.
      db.prepare("INSERT INTO ride_event_rsvp (event_id, user_id, status) VALUES (?, ?, 'going')").run(id, userId);
    })();
    res.status(201).json(toJson(byId(id)!, userId));
  }),
);

rideEventsRouter.get(
  "/:code",
  asyncHandler(async (req, res) => {
    const ev = byCode(req.params.code!);
    if (!ev) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    res.json(toJson(ev, req.user!.id));
  }),
);

rideEventsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ev = ownedBy(req.params.id!, userId);
    if (!ev) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    const input = rideEventInputSchema.parse(req.body);
    const startsAt = new Date(input.startsAt).toISOString();
    // Editing details of a ride already under way is fine; moving it into the
    // past is not.
    if (startsAt !== ev.starts_at) {
      const bad = checkStart(input.startsAt);
      if (bad) {
        res.status(400).json({ error: bad });
        return;
      }
    }
    getDb()
      .prepare(
        `UPDATE ride_event SET title = ?, note = ?, starts_at = ?, meet_name = ?, meet_lat = ?, meet_lng = ?,
           dest_name = ?, dest_lat = ?, dest_lng = ?, distance_km = ?, pace = ?, vehicle_kind = ?, max_riders = ?,
           reminded_at = CASE WHEN starts_at = ? THEN reminded_at ELSE NULL END,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        input.title,
        input.note || null,
        startsAt,
        input.meet.name,
        input.meet.lat ?? null,
        input.meet.lng ?? null,
        input.destination?.name ?? null,
        input.destination?.lat ?? null,
        input.destination?.lng ?? null,
        input.distanceKm ?? null,
        input.pace,
        input.vehicleKind,
        input.maxRiders ?? null,
        startsAt,
        ev.id,
      );
    const after = byId(ev.id)!;
    if (startsAt !== ev.starts_at || input.meet.name !== ev.meet_name) {
      notify(audience(after, userId), `ride-${ev.id}`, `/rides/${ev.code}`, (lang) =>
        lang === "en"
          ? { title: `${after.title} was updated`, body: `${whenText(after.starts_at, lang)} · ${after.meet_name}` }
          : { title: `${after.title} güncellendi`, body: `${whenText(after.starts_at, lang)} · ${after.meet_name}` },
      );
    }
    res.json(toJson(after, userId));
  }),
);

rideEventsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ev = ownedBy(req.params.id!, userId);
    if (!ev) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    if (!ev.cancelled_at) {
      getDb()
        .prepare("UPDATE ride_event SET cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .run(ev.id);
      notify(audience(ev, userId), `ride-${ev.id}`, `/rides/${ev.code}`, (lang) =>
        lang === "en"
          ? { title: `${ev.title} was cancelled`, body: `${whenText(ev.starts_at, lang)} · by the organiser` }
          : { title: `${ev.title} iptal edildi`, body: `${whenText(ev.starts_at, lang)} · organizatör iptal etti` },
      );
    }
    res.json(toJson(byId(ev.id)!, userId));
  }),
);

/** Hard delete. Anyone still expecting the ride hears it was called off. */
rideEventsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ev = ownedBy(req.params.id!, userId);
    if (!ev) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    getDb().prepare("DELETE FROM ride_event WHERE id = ?").run(ev.id);
    if (!ev.cancelled_at && Date.parse(ev.starts_at) > Date.now()) {
      notify(audience(ev, userId), `ride-${ev.id}`, "/rides", (lang) =>
        lang === "en"
          ? { title: `${ev.title} was cancelled`, body: whenText(ev.starts_at, lang) }
          : { title: `${ev.title} iptal edildi`, body: whenText(ev.starts_at, lang) },
      );
    }
    res.status(204).end();
  }),
);

rideEventsRouter.put(
  "/:code/rsvp",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ev = byCode(req.params.code!);
    if (!ev) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    if (ev.cancelled_at) {
      res.status(409).json({ error: "ride_cancelled" });
      return;
    }
    const { status, bikeId } = rsvpInputSchema.parse(req.body);
    if (bikeId && !ownsBike(userId, bikeId)) {
      res.status(400).json({ error: "bike_not_found" });
      return;
    }
    const db = getDb();
    const existing = db
      .prepare("SELECT status FROM ride_event_rsvp WHERE event_id = ? AND user_id = ?")
      .get(ev.id, userId) as { status: RsvpStatus } | undefined;
    if (status === "going" && existing?.status !== "going" && ev.max_riders) {
      const going = db
        .prepare("SELECT COUNT(*) AS n FROM ride_event_rsvp WHERE event_id = ? AND status = 'going'")
        .get(ev.id) as { n: number };
      if (going.n >= ev.max_riders) {
        res.status(409).json({ error: "ride_full" });
        return;
      }
    }
    db.prepare(
      `INSERT INTO ride_event_rsvp (event_id, user_id, status, bike_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status,
         bike_id = COALESCE(excluded.bike_id, ride_event_rsvp.bike_id), updated_at = datetime('now')`,
    ).run(ev.id, userId, status, bikeId ?? null);
    // Tell the organiser about a NEW rider only — flipping between going and
    // maybe is not news worth a buzz.
    if (!existing && userId !== ev.owner_id) {
      const who = nameOf(userId);
      notify([ev.owner_id], `ride-rsvp-${ev.id}`, `/rides/${ev.code}`, (lang) =>
        lang === "en"
          ? { title: ev.title, body: status === "going" ? `${who} is coming.` : `${who} might come.` }
          : { title: ev.title, body: status === "going" ? `${who} katılıyor.` : `${who} belki katılacak.` },
      );
    }
    res.json(toJson(byId(ev.id)!, userId));
  }),
);

rideEventsRouter.delete(
  "/:code/rsvp",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ev = byCode(req.params.code!);
    if (!ev) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    if (ev.owner_id === userId) {
      // The organiser cancels; they do not "leave" their own ride.
      res.status(409).json({ error: "owner_cannot_leave" });
      return;
    }
    getDb().prepare("DELETE FROM ride_event_rsvp WHERE event_id = ? AND user_id = ?").run(ev.id, userId);
    res.json(toJson(ev, userId));
  }),
);

/** The organiser removes somebody from the ride. */
rideEventsRouter.delete(
  "/:id/riders/:userId",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ev = ownedBy(req.params.id!, userId);
    if (!ev) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    if (req.params.userId === userId) {
      res.status(409).json({ error: "owner_cannot_leave" });
      return;
    }
    getDb()
      .prepare("DELETE FROM ride_event_rsvp WHERE event_id = ? AND user_id = ?")
      .run(ev.id, req.params.userId!);
    res.json(toJson(ev, userId));
  }),
);

/**
 * "Start the ride": opens a live map room led by the organiser, links it to
 * the plan, and pings everyone who said yes with the way in.
 */
rideEventsRouter.post(
  "/:id/live",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ev = ownedBy(req.params.id!, userId);
    if (!ev || ev.cancelled_at) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    const current = liveRideCode(ev.live_group_id);
    if (!current) {
      const g = openRideGroup(userId);
      getDb().prepare("UPDATE ride_event SET live_group_id = ? WHERE id = ?").run(g.id, ev.id);
      const going = (
        getDb()
          .prepare("SELECT user_id FROM ride_event_rsvp WHERE event_id = ? AND status IN ('going','maybe')")
          .all(ev.id) as { user_id: string }[]
      )
        .map((r) => r.user_id)
        .filter((id) => id !== userId);
      notify(going, `ride-${ev.id}`, `/rides/${ev.code}`, (lang) =>
        lang === "en"
          ? { title: `${ev.title} is live`, body: "Tap to join the group on the map." }
          : { title: `${ev.title} başladı`, body: "Haritada gruba katılmak için dokun." },
      );
    }
    res.json(toJson(byId(ev.id)!, userId));
  }),
);

const reportSchema = z.object({ reason: z.string().trim().max(500).optional() });

rideEventsRouter.post(
  "/:code/report",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ev = byCode(req.params.code!);
    if (!ev) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    const { reason } = reportSchema.parse(req.body ?? {});
    getDb()
      .prepare(
        `INSERT INTO ride_event_report (id, event_id, reporter_id, reason) VALUES (?, ?, ?, ?)
         ON CONFLICT(event_id, reporter_id) DO UPDATE SET reason = excluded.reason`,
      )
      .run(newId(), ev.id, userId, reason ?? null);
    console.warn(`[ride-report] event ${ev.id} (${ev.code}) reported by ${userId}: ${reason ?? "-"}`);
    // Whoever reported it should not keep seeing it in their list.
    if (ev.owner_id !== userId) {
      getDb().prepare("DELETE FROM ride_event_rsvp WHERE event_id = ? AND user_id = ?").run(ev.id, userId);
    }
    res.json({ ok: true });
  }),
);

// ─── public invite page ──────────────────────────────────────────────────────

/**
 * GET /r/:code — what a WhatsApp/iMessage link preview and a person without
 * the app see. Server-rendered so link unfurlers get real Open Graph tags; it
 * shows the plan (title, time, meeting point, head count — no names) and one
 * button into the app, where joining happens.
 */
export const rideInviteRouter: Router = Router();

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

rideInviteRouter.get("/:code", (req, res) => {
  const ev = byCode(String(req.params.code ?? ""));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.setHeader("X-Robots-Tag", "noindex");
  const appUrl = ev ? `/rides/${ev.code}` : "/rides";
  if (!ev) {
    res.status(404).send(invitePage({ title: "Sürüş bulunamadı", lines: ["Bağlantı geçersiz ya da sürüş silinmiş."], appUrl }));
    return;
  }
  const going = (
    getDb().prepare("SELECT COUNT(*) AS n FROM ride_event_rsvp WHERE event_id = ? AND status = 'going'").get(ev.id) as {
      n: number;
    }
  ).n;
  const when = whenText(ev.starts_at, "tr");
  const lines = [
    `📅 ${when}`,
    `📍 Buluşma: ${ev.meet_name}`,
    ...(ev.dest_name ? [`🏁 Varış: ${ev.dest_name}`] : []),
    `👥 ${going} kişi katılıyor`,
  ];
  if (ev.cancelled_at) lines.unshift("❌ Bu sürüş iptal edildi.");
  res.send(
    invitePage({
      title: ev.title,
      description: `${when} · ${ev.meet_name} · ${going} kişi katılıyor`,
      lines,
      appUrl,
    }),
  );
});

function invitePage(p: { title: string; description?: string; lines: string[]; appUrl: string }): string {
  const base = config.APP_BASE_URL.replace(/\/$/, "");
  const desc = p.description ?? p.lines.join(" · ");
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(p.title)} — Garajım</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Garajım"/>
<meta property="og:title" content="${esc(p.title)} · Grup sürüşü"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:image" content="${base}/brand/og-ride.png"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="apple-itunes-app" content="app-id=6783515081, app-argument=${base}${p.appUrl}"/>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:radial-gradient(120% 80% at 50% 0%,#1c2210,#0B0B0E 60%);color:#f4f4f5;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
.card{max-width:420px;width:100%;background:#141418;border:1px solid #26262c;border-radius:24px;padding:28px}
.eyebrow{color:#E1FF4D;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:26px;line-height:1.15;margin:.4rem 0 1rem}
p{margin:.35rem 0;color:#d4d4d8}
a.btn{display:block;text-align:center;margin-top:1.5rem;background:#E1FF4D;color:#0B0B0E;font-weight:700;text-decoration:none;padding:14px;border-radius:14px}
.muted{color:#71717a;font-size:13px;margin-top:1rem;text-align:center}
.muted a{color:#a1a1aa}
</style></head>
<body><main class="card">
<div class="eyebrow">Garajım · Grup sürüşü</div>
<h1>${esc(p.title)}</h1>
${p.lines.map((l) => `<p>${esc(l)}</p>`).join("\n")}
<a class="btn" href="${esc(p.appUrl)}">Sürüşe katıl</a>
<p class="muted">Garajım yok mu? <a href="https://apps.apple.com/app/id6783515081">App Store'dan indir</a></p>
</main></body></html>`;
}
