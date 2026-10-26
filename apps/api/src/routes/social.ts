import { Router } from "express";
import {
  commentInputSchema,
  postInputSchema,
  profileInputSchema,
  reportInputSchema,
  type FeedPage,
  type FeedPost,
  type GarageVehicle,
  type MyProfile,
  type PostComment,
  type PostDetail,
  type RiderProfile,
  type RiderSummary,
} from "@mototracker/shared";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { isObjectionable } from "../lib/contentFilter.js";
import { privacyTrimmedRoute } from "../lib/routePrivacy.js";
import { fireAndForget } from "../notify/events.js";
import { pushToUser, Semaphore, PUSH_CONCURRENCY } from "../notify/send.js";
import { asLang, DEFAULT_LANG, type Lang } from "../notify/messages.js";
import { sendModerationAlert } from "../auth/email.js";

/**
 * THE SOCIAL LAYER — profiles, follows, a feed of rides people chose to share,
 * "Gaz!" (kudos) and comments.
 *
 * Rules that every query below keeps:
 *  - A user who has no profile is invisible: no profile, no posts, no search
 *    result. Making a profile is the opt-in (and where the community rules are
 *    accepted — App Review 1.2).
 *  - Blocks are mutual in effect: if either side blocked the other, neither
 *    sees the other's profile, posts or comments, and neither can follow.
 *  - Content three different people reported is hidden for everyone until a
 *    person reviews it; content YOU reported is hidden for you at once.
 */
export const socialRouter: Router = Router();
socialRouter.use(requireUser);

/** Distinct reports that hide a post or comment for everyone pending review. */
const AUTO_HIDE_REPORTS = 3;
const PAGE = 20;

// ─── helpers ─────────────────────────────────────────────────────────────────

interface ProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  city: string | null;
  show_garage: number;
  rules_accepted_at: string | null;
}

const db = () => getDb();

function profileOf(userId: string): ProfileRow | undefined {
  return db().prepare("SELECT * FROM rider_profile WHERE user_id = ?").get(userId) as ProfileRow | undefined;
}

function profileByHandle(handle: string): ProfileRow | undefined {
  return db().prepare("SELECT * FROM rider_profile WHERE handle = ?").get(handle.replace(/^@/, "")) as
    | ProfileRow
    | undefined;
}

/** True when either user has blocked the other. */
function blockedBetween(a: string, b: string): boolean {
  return !!db()
    .prepare(
      "SELECT 1 FROM user_block WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
    )
    .get(a, b, b, a);
}

/** SQL fragment: `col` is not someone `me` blocked or who blocked `me`. Binds me twice. */
const NOT_BLOCKED = (col: string) =>
  `${col} NOT IN (SELECT blocked_id FROM user_block WHERE blocker_id = ?)
   AND ${col} NOT IN (SELECT blocker_id FROM user_block WHERE blocked_id = ?)`;

function isFollowing(me: string, other: string): boolean {
  return !!db().prepare("SELECT 1 FROM follow WHERE follower_id = ? AND followee_id = ?").get(me, other);
}

function requireProfile(userId: string, res: import("express").Response): ProfileRow | null {
  const p = profileOf(userId);
  if (!p || !p.rules_accepted_at) {
    res.status(409).json({ error: "profile_required" });
    return null;
  }
  return p;
}

function langOf(userId: string): Lang {
  const row = db().prepare("SELECT language FROM profile WHERE user_id = ?").get(userId) as
    | { language: string }
    | undefined;
  return row ? asLang(row.language) : DEFAULT_LANG;
}

const sem = new Semaphore(PUSH_CONCURRENCY);
function notify(userId: string, tag: string, url: string, build: (lang: Lang) => { title: string; body: string }) {
  fireAndForget(async () => {
    await pushToUser(userId, { ...build(langOf(userId)), url, tag }, sem);
  });
}

function suggestHandle(name: string | null, email: string): string {
  const base = (name || email.split("@")[0] || "rider")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 14);
  let h = /^[a-z]/.test(base) && base.length >= 3 ? base : `surucu${base}`.slice(0, 14);
  for (let i = 0; i < 20; i++) {
    const cand = i === 0 ? h : `${h}${Math.floor(Math.random() * 900 + 100)}`;
    if (!profileByHandle(cand)) return cand;
  }
  h = `surucu${Date.now().toString(36).slice(-6)}`;
  return h;
}

interface PostRow {
  id: string;
  user_id: string;
  caption: string | null;
  distance_km: number;
  duration_min: number;
  started_at: string;
  route: string | null;
  vehicle_type: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_name: string | null;
  created_at: string;
  handle: string;
  display_name: string;
  kudos: number;
  kudos_by_me: number;
  comments: number;
}

const POST_SELECT = `
  SELECT p.*, rp.handle, rp.display_name,
    (SELECT COUNT(*) FROM post_kudos k WHERE k.post_id = p.id) AS kudos,
    (SELECT COUNT(*) FROM post_kudos k WHERE k.post_id = p.id AND k.user_id = @me) AS kudos_by_me,
    (SELECT COUNT(*) FROM post_comment c WHERE c.post_id = p.id AND c.hidden_at IS NULL) AS comments
  FROM post p JOIN rider_profile rp ON rp.user_id = p.user_id
  WHERE p.hidden_at IS NULL
    AND p.user_id NOT IN (SELECT blocked_id FROM user_block WHERE blocker_id = @me)
    AND p.user_id NOT IN (SELECT blocker_id FROM user_block WHERE blocked_id = @me)
    AND p.id NOT IN (SELECT target_id FROM content_report WHERE reporter_id = @me AND target_kind = 'post')`;

function toPost(r: PostRow, me: string): FeedPost {
  return {
    id: r.id,
    author: { userId: r.user_id, handle: r.handle, displayName: r.display_name },
    isMine: r.user_id === me,
    caption: r.caption,
    distanceKm: r.distance_km,
    durationMin: r.duration_min,
    startedAt: r.started_at,
    route: r.route,
    vehicle: {
      vehicleType: (r.vehicle_type as FeedPost["vehicle"]["vehicleType"]) ?? null,
      make: r.vehicle_make,
      model: r.vehicle_model,
      color: r.vehicle_color,
      name: r.vehicle_name,
    },
    kudos: r.kudos,
    kudosByMe: r.kudos_by_me > 0,
    comments: r.comments,
    createdAt: r.created_at,
  };
}

function summaryOf(p: ProfileRow, me: string, reason?: string | null): RiderSummary {
  return {
    userId: p.user_id,
    handle: p.handle,
    displayName: p.display_name,
    city: p.city,
    isFollowing: isFollowing(me, p.user_id),
    reason: reason ?? null,
  };
}

// ─── my profile ──────────────────────────────────────────────────────────────

socialRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const p = profileOf(me);
    const u = db().prepare("SELECT name, email FROM user WHERE id = ?").get(me) as { name: string | null; email: string };
    const body: MyProfile = {
      profile: p
        ? {
            handle: p.handle,
            displayName: p.display_name,
            bio: p.bio,
            city: p.city,
            showGarage: !!p.show_garage,
            rulesAccepted: !!p.rules_accepted_at,
          }
        : null,
      suggestedHandle: p?.handle ?? suggestHandle(u.name, u.email),
      suggestedName: p?.display_name ?? (u.name?.trim() || u.email.split("@")[0] || ""),
    };
    res.json(body);
  }),
);

socialRouter.put(
  "/me",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const input = profileInputSchema.parse(req.body);
    const existing = profileOf(me);
    if (!existing?.rules_accepted_at && !input.acceptRules) {
      res.status(400).json({ error: "rules_not_accepted" });
      return;
    }
    if ([input.displayName, input.bio, input.city, input.handle].some(isObjectionable)) {
      res.status(400).json({ error: "objectionable" });
      return;
    }
    const taken = profileByHandle(input.handle);
    if (taken && taken.user_id !== me) {
      res.status(409).json({ error: "handle_taken" });
      return;
    }
    db()
      .prepare(
        `INSERT INTO rider_profile (user_id, handle, display_name, bio, city, show_garage, rules_accepted_at)
         VALUES (@me, @handle, @name, @bio, @city, @garage, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET handle = @handle, display_name = @name, bio = @bio, city = @city,
           show_garage = @garage, rules_accepted_at = COALESCE(rider_profile.rules_accepted_at, datetime('now')),
           updated_at = datetime('now')`,
      )
      .run({
        me,
        handle: input.handle,
        name: input.displayName,
        bio: input.bio || null,
        city: input.city || null,
        garage: input.showGarage ? 1 : 0,
      });
    const p = profileOf(me)!;
    res.json({
      profile: {
        handle: p.handle,
        displayName: p.display_name,
        bio: p.bio,
        city: p.city,
        showGarage: !!p.show_garage,
        rulesAccepted: true,
      },
      suggestedHandle: p.handle,
      suggestedName: p.display_name,
    } satisfies MyProfile);
  }),
);

// ─── profiles ────────────────────────────────────────────────────────────────

socialRouter.get(
  "/profiles/:handle",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const p = profileByHandle(req.params.handle!);
    if (!p || (p.user_id !== me && blockedBetween(me, p.user_id))) {
      res.status(404).json({ error: "profile_not_found" });
      return;
    }
    const counts = db()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM follow WHERE followee_id = ?) AS followers,
                (SELECT COUNT(*) FROM follow WHERE follower_id = ?) AS following,
                (SELECT COUNT(*) FROM post WHERE user_id = ? AND hidden_at IS NULL) AS posts,
                (SELECT COALESCE(SUM(distance_km), 0) FROM trip WHERE user_id = ?) AS km,
                (SELECT COUNT(*) FROM trip WHERE user_id = ?) AS rides`,
      )
      .get(p.user_id, p.user_id, p.user_id, p.user_id, p.user_id) as {
      followers: number;
      following: number;
      posts: number;
      km: number;
      rides: number;
    };
    const garage =
      p.show_garage || p.user_id === me
        ? (db()
            .prepare(
              `SELECT id, vehicle_type, make, model, year, color, cylinder_cc, nickname FROM bike
                WHERE user_id = ? AND archived = 0 AND org_id IS NULL ORDER BY created_at`,
            )
            .all(p.user_id) as Array<{
            id: string;
            vehicle_type: "motorcycle" | "car";
            make: string | null;
            model: string | null;
            year: number | null;
            color: string | null;
            cylinder_cc: number | null;
            nickname: string;
          }>).map(
            (b): GarageVehicle => ({
              id: b.id,
              vehicleType: b.vehicle_type,
              make: b.make,
              model: b.model,
              year: b.year,
              color: b.color,
              cylinderCc: b.cylinder_cc,
              nickname: b.nickname,
            }),
          )
        : [];
    const body: RiderProfile = {
      ...summaryOf(p, me),
      bio: p.bio,
      isMe: p.user_id === me,
      followsMe: isFollowing(p.user_id, me),
      blocked: !!db().prepare("SELECT 1 FROM user_block WHERE blocker_id = ? AND blocked_id = ?").get(me, p.user_id),
      showGarage: !!p.show_garage,
      followers: counts.followers,
      following: counts.following,
      stats: { posts: counts.posts, km: Math.round(counts.km), rides: counts.rides },
      garage,
    };
    res.json(body);
  }),
);

socialRouter.get(
  "/profiles/:handle/posts",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const p = profileByHandle(req.params.handle!);
    if (!p || (p.user_id !== me && blockedBetween(me, p.user_id))) {
      res.status(404).json({ error: "profile_not_found" });
      return;
    }
    const before = typeof req.query.before === "string" ? req.query.before : "9999";
    const rows = db()
      .prepare(`${POST_SELECT} AND p.user_id = @uid AND p.created_at < @before ORDER BY p.created_at DESC LIMIT @lim`)
      .all({ me, uid: p.user_id, before, lim: PAGE }) as PostRow[];
    res.json({
      posts: rows.map((r) => toPost(r, me)),
      next: rows.length === PAGE ? rows[rows.length - 1]!.created_at : null,
    } satisfies FeedPage);
  }),
);

function listPeople(sql: string, me: string, ...args: unknown[]): RiderSummary[] {
  return (db().prepare(sql).all(...args) as ProfileRow[]).map((p) => summaryOf(p, me));
}

socialRouter.get(
  "/profiles/:handle/followers",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const p = profileByHandle(req.params.handle!);
    if (!p || (p.user_id !== me && blockedBetween(me, p.user_id))) {
      res.status(404).json({ error: "profile_not_found" });
      return;
    }
    res.json(
      listPeople(
        `SELECT rp.* FROM follow f JOIN rider_profile rp ON rp.user_id = f.follower_id
          WHERE f.followee_id = ? AND ${NOT_BLOCKED("rp.user_id")} ORDER BY f.created_at DESC LIMIT 200`,
        me,
        p.user_id,
        me,
        me,
      ),
    );
  }),
);

socialRouter.get(
  "/profiles/:handle/following",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const p = profileByHandle(req.params.handle!);
    if (!p || (p.user_id !== me && blockedBetween(me, p.user_id))) {
      res.status(404).json({ error: "profile_not_found" });
      return;
    }
    res.json(
      listPeople(
        `SELECT rp.* FROM follow f JOIN rider_profile rp ON rp.user_id = f.followee_id
          WHERE f.follower_id = ? AND ${NOT_BLOCKED("rp.user_id")} ORDER BY f.created_at DESC LIMIT 200`,
        me,
        p.user_id,
        me,
        me,
      ),
    );
  }),
);

socialRouter.post(
  "/profiles/:handle/follow",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    if (!requireProfile(me, res)) return;
    const p = profileByHandle(req.params.handle!);
    if (!p || p.user_id === me || blockedBetween(me, p.user_id)) {
      res.status(404).json({ error: "profile_not_found" });
      return;
    }
    const r = db().prepare("INSERT OR IGNORE INTO follow (follower_id, followee_id) VALUES (?, ?)").run(me, p.user_id);
    if (r.changes > 0) {
      const mine = profileOf(me)!;
      notify(p.user_id, `follow-${me}`, `/u/${mine.handle}`, (lang) =>
        lang === "en"
          ? { title: "New follower", body: `${mine.display_name} (@${mine.handle}) started following you.` }
          : { title: "Yeni takipçi", body: `${mine.display_name} (@${mine.handle}) seni takip etmeye başladı.` },
      );
    }
    res.json({ following: true });
  }),
);

socialRouter.delete(
  "/profiles/:handle/follow",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const p = profileByHandle(req.params.handle!);
    if (p) db().prepare("DELETE FROM follow WHERE follower_id = ? AND followee_id = ?").run(me, p.user_id);
    res.json({ following: false });
  }),
);

// ─── discovery ───────────────────────────────────────────────────────────────

socialRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const q = String(req.query.q ?? "").trim().replace(/^@/, "").toLocaleLowerCase("tr-TR");
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const like = `%${q.replace(/[%_]/g, "")}%`;
    res.json(
      listPeople(
        `SELECT * FROM rider_profile rp
          WHERE rp.user_id <> ? AND (rp.handle LIKE ? OR lower(rp.display_name) LIKE ?)
            AND ${NOT_BLOCKED("rp.user_id")}
          ORDER BY (rp.handle LIKE ?) DESC, rp.handle LIMIT 30`,
        me,
        me,
        like,
        like,
        me,
        me,
        `${q}%`,
      ),
    );
  }),
);

/**
 * People you may know: first those you have been on a planned ride with, then
 * people followed by people you follow. Never anyone you already follow.
 */
socialRouter.get(
  "/suggestions",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const out: RiderSummary[] = [];
    const seen = new Set<string>([me]);
    const push = (rows: ProfileRow[], reason: string) => {
      for (const p of rows) {
        if (seen.has(p.user_id) || out.length >= 12) continue;
        seen.add(p.user_id);
        out.push(summaryOf(p, me, reason));
      }
    };
    push(
      db()
        .prepare(
          `SELECT DISTINCT rp.* FROM ride_event_rsvp mine
             JOIN ride_event e ON e.id = mine.event_id
             JOIN ride_event_rsvp other ON other.event_id = e.id AND other.user_id <> mine.user_id
             JOIN rider_profile rp ON rp.user_id = other.user_id
            WHERE mine.user_id = ? AND rp.user_id NOT IN (SELECT followee_id FROM follow WHERE follower_id = ?)
              AND ${NOT_BLOCKED("rp.user_id")}
            LIMIT 12`,
        )
        .all(me, me, me, me) as ProfileRow[],
      "rodeTogether",
    );
    push(
      db()
        .prepare(
          `SELECT rp.*, COUNT(*) AS n FROM follow f1
             JOIN follow f2 ON f2.follower_id = f1.followee_id
             JOIN rider_profile rp ON rp.user_id = f2.followee_id
            WHERE f1.follower_id = ? AND rp.user_id <> ?
              AND rp.user_id NOT IN (SELECT followee_id FROM follow WHERE follower_id = ?)
              AND ${NOT_BLOCKED("rp.user_id")}
            GROUP BY rp.user_id ORDER BY n DESC LIMIT 12`,
        )
        .all(me, me, me, me, me) as ProfileRow[],
      "friendsOfFriends",
    );
    // New riders, so an empty network still has somewhere to start.
    push(
      db()
        .prepare(
          `SELECT rp.* FROM rider_profile rp
            WHERE rp.user_id <> ? AND rp.user_id NOT IN (SELECT followee_id FROM follow WHERE follower_id = ?)
              AND EXISTS (SELECT 1 FROM post WHERE user_id = rp.user_id AND hidden_at IS NULL)
              AND ${NOT_BLOCKED("rp.user_id")}
            ORDER BY rp.created_at DESC LIMIT 12`,
        )
        .all(me, me, me, me) as ProfileRow[],
      "active",
    );
    res.json(out);
  }),
);

// ─── feed & posts ────────────────────────────────────────────────────────────

socialRouter.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const before = typeof req.query.before === "string" ? req.query.before : "9999";
    const rows = db()
      .prepare(
        `${POST_SELECT}
           AND (p.user_id = @me OR p.user_id IN (SELECT followee_id FROM follow WHERE follower_id = @me))
           AND p.created_at < @before
         ORDER BY p.created_at DESC LIMIT @lim`,
      )
      .all({ me, before, lim: PAGE }) as PostRow[];
    res.json({
      posts: rows.map((r) => toPost(r, me)),
      next: rows.length === PAGE ? rows[rows.length - 1]!.created_at : null,
    } satisfies FeedPage);
  }),
);

socialRouter.post(
  "/posts",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    if (!requireProfile(me, res)) return;
    const input = postInputSchema.parse(req.body);
    if (isObjectionable(input.caption)) {
      res.status(400).json({ error: "objectionable" });
      return;
    }
    // Only your own trips, on your own (non-fleet) vehicles.
    const trip = db()
      .prepare(
        `SELECT t.*, b.vehicle_type, b.make, b.model, b.color, b.nickname, b.org_id FROM trip t
           JOIN bike b ON b.id = t.bike_id WHERE t.id = ? AND t.user_id = ?`,
      )
      .get(input.tripId, me) as
      | {
          id: string;
          distance_km: number;
          started_at: string;
          ended_at: string;
          route: string | null;
          vehicle_type: string;
          make: string | null;
          model: string | null;
          color: string | null;
          nickname: string;
          org_id: string | null;
        }
      | undefined;
    if (!trip || trip.org_id) {
      res.status(404).json({ error: "trip_not_found" });
      return;
    }
    const existing = db().prepare("SELECT id FROM post WHERE trip_id = ?").get(trip.id) as { id: string } | undefined;
    if (existing) {
      res.status(409).json({ error: "already_posted", postId: existing.id });
      return;
    }
    const id = newId();
    const minutes = Math.max(0, Math.round((Date.parse(trip.ended_at) - Date.parse(trip.started_at)) / 60_000));
    db()
      .prepare(
        `INSERT INTO post (id, user_id, trip_id, caption, distance_km, duration_min, started_at, route,
           vehicle_type, vehicle_make, vehicle_model, vehicle_color, vehicle_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        me,
        trip.id,
        input.caption || null,
        trip.distance_km,
        minutes,
        trip.started_at,
        input.showRoute ? privacyTrimmedRoute(trip.route) : null,
        trip.vehicle_type,
        trip.make,
        trip.model,
        trip.color,
        trip.nickname,
      );
    const row = db().prepare(`${POST_SELECT} AND p.id = @id`).get({ me, id }) as PostRow;
    res.status(201).json(toPost(row, me));
  }),
);

function visiblePost(id: string, me: string): PostRow | undefined {
  return db().prepare(`${POST_SELECT} AND p.id = @id`).get({ me, id }) as PostRow | undefined;
}

socialRouter.get(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const row = visiblePost(req.params.id!, me);
    if (!row) {
      res.status(404).json({ error: "post_not_found" });
      return;
    }
    const comments = db()
      .prepare(
        `SELECT c.*, rp.handle, rp.display_name FROM post_comment c JOIN rider_profile rp ON rp.user_id = c.user_id
          WHERE c.post_id = ? AND c.hidden_at IS NULL AND ${NOT_BLOCKED("c.user_id")}
            AND c.id NOT IN (SELECT target_id FROM content_report WHERE reporter_id = ? AND target_kind = 'comment')
          ORDER BY c.created_at`,
      )
      .all(row.id, me, me, me) as Array<{
      id: string;
      user_id: string;
      body: string;
      created_at: string;
      handle: string;
      display_name: string;
    }>;
    const kudosBy = db()
      .prepare(
        `SELECT rp.handle, rp.display_name FROM post_kudos k JOIN rider_profile rp ON rp.user_id = k.user_id
          WHERE k.post_id = ? AND ${NOT_BLOCKED("k.user_id")} ORDER BY k.created_at DESC LIMIT 50`,
      )
      .all(row.id, me, me) as Array<{ handle: string; display_name: string }>;
    const body: PostDetail = {
      ...toPost(row, me),
      commentList: comments.map(
        (c): PostComment => ({
          id: c.id,
          author: { userId: c.user_id, handle: c.handle, displayName: c.display_name },
          body: c.body,
          isMine: c.user_id === me,
          createdAt: c.created_at,
        }),
      ),
      kudosBy: kudosBy.map((k) => ({ handle: k.handle, displayName: k.display_name })),
    };
    res.json(body);
  }),
);

socialRouter.patch(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const caption = postInputSchema.shape.caption.parse(req.body?.caption);
    if (isObjectionable(caption)) {
      res.status(400).json({ error: "objectionable" });
      return;
    }
    const r = db().prepare("UPDATE post SET caption = ? WHERE id = ? AND user_id = ?").run(caption || null, req.params.id!, me);
    if (r.changes === 0) {
      res.status(404).json({ error: "post_not_found" });
      return;
    }
    res.json(toPost(visiblePost(req.params.id!, me)!, me));
  }),
);

socialRouter.delete(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const r = db().prepare("DELETE FROM post WHERE id = ? AND user_id = ?").run(req.params.id!, me);
    res.status(r.changes ? 204 : 404).end();
  }),
);

socialRouter.post(
  "/posts/:id/kudos",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    if (!requireProfile(me, res)) return;
    const row = visiblePost(req.params.id!, me);
    if (!row) {
      res.status(404).json({ error: "post_not_found" });
      return;
    }
    const r = db().prepare("INSERT OR IGNORE INTO post_kudos (post_id, user_id) VALUES (?, ?)").run(row.id, me);
    if (r.changes > 0 && row.user_id !== me) {
      const mine = profileOf(me)!;
      notify(row.user_id, `kudos-${row.id}`, `/posts/${row.id}`, (lang) =>
        lang === "en"
          ? { title: "Gaz! 🔥", body: `${mine.display_name} gave kudos to your ${Math.round(row.distance_km)} km ride.` }
          : { title: "Gaz! 🔥", body: `${mine.display_name}, ${Math.round(row.distance_km)} km'lik sürüşüne gaz verdi.` },
      );
    }
    res.json(toPost(visiblePost(row.id, me)!, me));
  }),
);

socialRouter.delete(
  "/posts/:id/kudos",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    db().prepare("DELETE FROM post_kudos WHERE post_id = ? AND user_id = ?").run(req.params.id!, me);
    const row = visiblePost(req.params.id!, me);
    if (!row) {
      res.status(404).json({ error: "post_not_found" });
      return;
    }
    res.json(toPost(row, me));
  }),
);

socialRouter.post(
  "/posts/:id/comments",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    if (!requireProfile(me, res)) return;
    const { body } = commentInputSchema.parse(req.body);
    if (isObjectionable(body)) {
      res.status(400).json({ error: "objectionable" });
      return;
    }
    const row = visiblePost(req.params.id!, me);
    if (!row) {
      res.status(404).json({ error: "post_not_found" });
      return;
    }
    const id = newId();
    db().prepare("INSERT INTO post_comment (id, post_id, user_id, body) VALUES (?, ?, ?, ?)").run(id, row.id, me, body);
    if (row.user_id !== me) {
      const mine = profileOf(me)!;
      notify(row.user_id, `comment-${row.id}`, `/posts/${row.id}`, (lang) => ({
        title: lang === "en" ? `${mine.display_name} commented` : `${mine.display_name} yorum yaptı`,
        body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      }));
    }
    res.status(201).json({ id });
  }),
);

/** The comment's author or the post's owner may delete a comment. */
socialRouter.delete(
  "/comments/:id",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const r = db()
      .prepare(
        `DELETE FROM post_comment WHERE id = ?
           AND (user_id = ? OR post_id IN (SELECT id FROM post WHERE user_id = ?))`,
      )
      .run(req.params.id!, me, me);
    res.status(r.changes ? 204 : 404).end();
  }),
);

// ─── safety ──────────────────────────────────────────────────────────────────

socialRouter.post(
  "/reports",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const { kind, targetId, reason } = reportInputSchema.parse(req.body);
    const d = db();
    d.prepare(
      `INSERT INTO content_report (id, reporter_id, target_kind, target_id, reason) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(reporter_id, target_kind, target_id) DO UPDATE SET reason = excluded.reason`,
    ).run(newId(), me, kind, targetId, reason ?? null);
    const n = (
      d.prepare("SELECT COUNT(*) AS n FROM content_report WHERE target_kind = ? AND target_id = ?").get(kind, targetId) as {
        n: number;
      }
    ).n;
    if (n >= AUTO_HIDE_REPORTS) {
      if (kind === "post") d.prepare("UPDATE post SET hidden_at = datetime('now') WHERE id = ? AND hidden_at IS NULL").run(targetId);
      if (kind === "comment")
        d.prepare("UPDATE post_comment SET hidden_at = datetime('now') WHERE id = ? AND hidden_at IS NULL").run(targetId);
    }
    let excerpt = "";
    if (kind === "post") excerpt = (d.prepare("SELECT caption FROM post WHERE id = ?").get(targetId) as { caption: string | null } | undefined)?.caption ?? "";
    if (kind === "comment") excerpt = (d.prepare("SELECT body FROM post_comment WHERE id = ?").get(targetId) as { body: string } | undefined)?.body ?? "";
    if (kind === "user") excerpt = profileOf(targetId)?.handle ?? "";
    console.warn(`[report] ${kind} ${targetId} by ${me} (${n} total): ${reason ?? "-"}`);
    fireAndForget(() =>
      sendModerationAlert(
        `${kind} bildirildi (${n})`,
        `Tür: ${kind}\nHedef: ${targetId}\nBildiren: ${me}\nNeden: ${reason ?? "-"}\nToplam bildirim: ${n}${n >= AUTO_HIDE_REPORTS ? " — otomatik gizlendi" : ""}\n\nİçerik:\n${excerpt}`,
      ),
    );
    res.json({ ok: true });
  }),
);

socialRouter.get(
  "/blocks",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const rows = db()
      .prepare(
        `SELECT b.blocked_id AS userId, rp.handle, rp.display_name AS displayName FROM user_block b
           LEFT JOIN rider_profile rp ON rp.user_id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
      )
      .all(me);
    res.json(rows);
  }),
);

socialRouter.post(
  "/blocks/:userId",
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const other = req.params.userId!;
    if (other === me || !db().prepare("SELECT 1 FROM user WHERE id = ?").get(other)) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    const d = db();
    d.transaction(() => {
      d.prepare("INSERT OR IGNORE INTO user_block (blocker_id, blocked_id) VALUES (?, ?)").run(me, other);
      // A block severs the follow in both directions.
      d.prepare("DELETE FROM follow WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)").run(
        me,
        other,
        other,
        me,
      );
    })();
    res.json({ blocked: true });
  }),
);

socialRouter.delete(
  "/blocks/:userId",
  asyncHandler(async (req, res) => {
    db().prepare("DELETE FROM user_block WHERE blocker_id = ? AND blocked_id = ?").run(req.user!.id, req.params.userId!);
    res.json({ blocked: false });
  }),
);
