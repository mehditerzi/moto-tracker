import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { createRideTicket, closeRideRoom } from "../lib/rideHub.js";

/**
 * Group rides. A group lives at most RIDE_MAX_AGE (stale groups read as
 * ended), members join by a short code, and the owner leaving ends the ride
 * for everyone. Positions never touch these tables — see lib/rideHub.ts.
 */
export const rideGroupsRouter: Router = Router();
rideGroupsRouter.use(requireUser);

const RIDE_MAX_AGE = "-24 hours";

/** Code alphabet avoids 0/O/1/I lookalikes — it gets read out loud on rides. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newCode(): string {
  let code = "";
  for (const byte of crypto.randomBytes(6)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

interface GroupRow {
  id: string;
  owner_id: string;
  code: string;
  created_at: string;
  ended_at: string | null;
}

function activeGroupFor(userId: string): GroupRow | undefined {
  return getDb()
    .prepare(
      `SELECT g.* FROM ride_group g
         JOIN ride_member m ON m.group_id = g.id
        WHERE m.user_id = ? AND m.left_at IS NULL AND g.ended_at IS NULL
          AND g.created_at > datetime('now', ?)
        ORDER BY g.created_at DESC LIMIT 1`,
    )
    .get(userId, RIDE_MAX_AGE) as GroupRow | undefined;
}

function memberList(groupId: string) {
  return getDb()
    .prepare(
      `SELECT u.id AS userId, COALESCE(NULLIF(u.name, ''), u.email) AS name
         FROM ride_member m JOIN user u ON u.id = m.user_id
        WHERE m.group_id = ? AND m.left_at IS NULL ORDER BY m.joined_at`,
    )
    .all(groupId) as Array<{ userId: string; name: string }>;
}

function displayName(userId: string): string {
  const u = getDb()
    .prepare("SELECT COALESCE(NULLIF(name, ''), email) AS name FROM user WHERE id = ?")
    .get(userId) as { name: string } | undefined;
  return u?.name ?? "?";
}

function toJson(g: GroupRow, userId: string) {
  return {
    id: g.id,
    code: g.code,
    isOwner: g.owner_id === userId,
    createdAt: g.created_at,
    members: memberList(g.id),
  };
}

/** Leave (and, for the owner, end) whatever group the user is currently in. */
function leaveCurrent(userId: string): void {
  const g = activeGroupFor(userId);
  if (!g) return;
  const db = getDb();
  if (g.owner_id === userId) {
    db.prepare("UPDATE ride_group SET ended_at = datetime('now') WHERE id = ?").run(g.id);
    closeRideRoom(g.id);
  } else {
    db.prepare(
      "UPDATE ride_member SET left_at = datetime('now') WHERE group_id = ? AND user_id = ?",
    ).run(g.id, userId);
  }
}

// Current group (or null) — the /map tab's state on load.
rideGroupsRouter.get(
  "/active",
  asyncHandler(async (req, res) => {
    const g = activeGroupFor(req.user!.id);
    res.json(g ? toJson(g, req.user!.id) : null);
  }),
);

rideGroupsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    leaveCurrent(userId); // one active ride per user
    const db = getDb();
    const id = newId();
    const code = newCode();
    db.prepare("INSERT INTO ride_group (id, owner_id, code) VALUES (?, ?, ?)").run(id, userId, code);
    db.prepare("INSERT INTO ride_member (group_id, user_id) VALUES (?, ?)").run(id, userId);
    res.status(201).json(toJson(activeGroupFor(userId)!, userId));
  }),
);

const joinSchema = z.object({ code: z.string().trim().min(4).max(12) });

rideGroupsRouter.post(
  "/join",
  asyncHandler(async (req, res) => {
    const { code } = joinSchema.parse(req.body);
    const userId = req.user!.id;
    const db = getDb();
    const g = db
      .prepare(
        `SELECT * FROM ride_group
          WHERE code = ? AND ended_at IS NULL AND created_at > datetime('now', ?)`,
      )
      .get(code.toUpperCase(), RIDE_MAX_AGE) as GroupRow | undefined;
    if (!g) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    leaveCurrent(userId);
    db.prepare(
      `INSERT INTO ride_member (group_id, user_id) VALUES (?, ?)
       ON CONFLICT(group_id, user_id) DO UPDATE SET left_at = NULL, joined_at = datetime('now')`,
    ).run(g.id, userId);
    res.json(toJson(g, userId));
  }),
);

rideGroupsRouter.post(
  "/leave",
  asyncHandler(async (req, res) => {
    leaveCurrent(req.user!.id);
    res.json({ ok: true });
  }),
);

// One-time WebSocket ticket for the user's active group.
rideGroupsRouter.get(
  "/ws-ticket",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const g = activeGroupFor(userId);
    if (!g) {
      res.status(404).json({ error: "ride_not_found" });
      return;
    }
    res.json({ ticket: createRideTicket(userId, g.id, displayName(userId)) });
  }),
);
