import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { config } from "../config.js";
import {
  orgInviteAcceptSchema,
  orgInviteCreateSchema,
  orgMemberRoleUpdateSchema,
  type OrgRole,
} from "@mototracker/shared";
import { requireOrgRole } from "../lib/orgAccess.js";

/**
 * Members and invitations — the `/fleet/people` screen.
 *
 * Two rules run through everything here:
 *
 *  1. AN ORG ALWAYS HAS AN OWNER. Every path that could remove the last one
 *     (demotion and removal) checks first and answers `last_owner`. Without it a
 *     fleet can be left with nobody who may re-invite an owner, and the only fix
 *     is a database console.
 *  2. A MANAGER CANNOT MAKE OR UNMAKE OWNERS. Managers manage members, which is
 *     what §2 of the design doc grants them — but if that included owners, any
 *     manager could promote themselves and delete the org. Owner-touching acts
 *     require an owner.
 */
export const orgMembersRouter: Router = Router();
orgMembersRouter.use(requireUser);

// ─── members ──────────────────────────────────────────────────────────────────

interface MemberRow {
  org_id: string;
  user_id: string;
  role: OrgRole;
  status: "active" | "removed";
  joined_at: string;
  email: string | null;
  name: string | null;
}

interface HoldingRow {
  user_id: string;
  bike_id: string;
  plate: string | null;
  nickname: string;
  started_at: string;
}

/** Active owners in an org. The number the last-owner guard protects. */
function activeOwnerCount(orgId: string): number {
  return (
    getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM org_member WHERE org_id = ? AND role = 'owner' AND status = 'active'",
      )
      .get(orgId) as { n: number }
  ).n;
}

/**
 * May the caller act on / assign this role? Owners may do anything; managers are
 * fenced out of the owner role in both directions.
 */
function mayTouchRole(callerRole: OrgRole, targetRole: OrgRole): boolean {
  return callerRole === "owner" || targetRole !== "owner";
}

const memberListQuery = z.object({
  includeRemoved: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

/**
 * The member list. Owner/manager only, per the IA (§5): `/fleet/people` is a
 * management screen, and staff have no business enumerating their colleagues.
 *
 * In fleet mode each member carries what they are currently holding, which is
 * the other half of "who is driving this today" and saves the screen a second
 * round trip. Two queries total, never one per member.
 */
orgMembersRouter.get(
  "/:orgId/members",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const { includeRemoved } = memberListQuery.parse(req.query);
    const db = getDb();
    const orgId = req.orgMembership!.orgId;

    const members = db
      .prepare(
        `SELECT m.org_id, m.user_id, m.role, m.status, m.joined_at, u.email, u.name
           FROM org_member m
           JOIN user u ON u.id = m.user_id
          WHERE m.org_id = ?${includeRemoved ? "" : " AND m.status = 'active'"}
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
                   u.email ASC`,
      )
      .all(orgId) as MemberRow[];

    const holdings = db
      .prepare(
        `SELECT va.user_id, va.bike_id, b.plate, b.nickname, va.started_at
           FROM vehicle_assignment va
           JOIN bike b ON b.id = va.bike_id
          WHERE va.org_id = ? AND va.ended_at IS NULL`,
      )
      .all(orgId) as HoldingRow[];

    const byUser = new Map<string, HoldingRow[]>();
    for (const h of holdings) {
      const list = byUser.get(h.user_id) ?? [];
      list.push(h);
      byUser.set(h.user_id, list);
    }

    res.json(
      members.map((m) => ({
        orgId: m.org_id,
        userId: m.user_id,
        role: m.role,
        status: m.status,
        joinedAt: m.joined_at,
        email: m.email,
        name: m.name,
        isSelf: m.user_id === req.user!.id,
        assignments: (byUser.get(m.user_id) ?? []).map((h) => ({
          bikeId: h.bike_id,
          plate: h.plate,
          nickname: h.nickname,
          startedAt: h.started_at,
        })),
      })),
    );
  }),
);

orgMembersRouter.patch(
  "/:orgId/members/:userId",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const { role } = orgMemberRoleUpdateSchema.parse(req.body);
    const db = getDb();
    const caller = req.orgMembership!;
    const targetId = req.params.userId!;

    const target = db
      .prepare("SELECT role, status FROM org_member WHERE org_id = ? AND user_id = ?")
      .get(caller.orgId, targetId) as { role: OrgRole; status: string } | undefined;
    if (!target || target.status !== "active") {
      res.status(404).json({ error: "member_not_found" });
      return;
    }
    // Both the CURRENT and the NEW role are gated: a manager must be unable to
    // demote an owner and unable to mint one.
    if (!mayTouchRole(caller.role, target.role) || !mayTouchRole(caller.role, role)) {
      res.status(403).json({ error: "owner_role_required" });
      return;
    }
    if (target.role === role) {
      res.status(200).json({ orgId: caller.orgId, userId: targetId, role });
      return;
    }
    // Demoting the last owner leaves nobody who can restore one.
    if (target.role === "owner" && activeOwnerCount(caller.orgId) <= 1) {
      res.status(409).json({ error: "last_owner" });
      return;
    }

    // Demotion to `driver` is a real revocation: a driver may only see vehicles
    // assigned to them, so anything the ex-manager was holding must be either
    // explicit or gone. Their open assignments survive (they still hold those
    // vehicles); everything else stops being visible the moment the role lands.
    db.prepare("UPDATE org_member SET role = ? WHERE org_id = ? AND user_id = ?").run(
      role,
      caller.orgId,
      targetId,
    );
    res.json({ orgId: caller.orgId, userId: targetId, role });
  }),
);

orgMembersRouter.delete(
  "/:orgId/members/:userId",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const caller = req.orgMembership!;
    const targetId = req.params.userId!;

    const target = db
      .prepare("SELECT role, status FROM org_member WHERE org_id = ? AND user_id = ?")
      .get(caller.orgId, targetId) as { role: OrgRole; status: string } | undefined;
    if (!target || target.status !== "active") {
      res.status(404).json({ error: "member_not_found" });
      return;
    }
    if (!mayTouchRole(caller.role, target.role)) {
      res.status(403).json({ error: "owner_role_required" });
      return;
    }
    if (target.role === "owner" && activeOwnerCount(caller.orgId) <= 1) {
      res.status(409).json({ error: "last_owner" });
      return;
    }

    const remove = db.transaction(() => {
      // The membership row is kept (status='removed') so history still resolves
      // to a name — see 021_organization.sql. Access is gone immediately because
      // every check in orgAccess requires status='active'.
      db.prepare(
        "UPDATE org_member SET status = 'removed' WHERE org_id = ? AND user_id = ?",
      ).run(caller.orgId, targetId);
      // Close whatever they were holding. Not for access (the membership join in
      // orgAccess already revokes that) but for the fleet: an open assignment
      // holds the vehicle's only open slot through the partial unique index, so
      // leaving it would make the vehicle unassignable to anyone else.
      db.prepare(
        "UPDATE vehicle_assignment SET ended_at = datetime('now') WHERE org_id = ? AND user_id = ? AND ended_at IS NULL",
      ).run(caller.orgId, targetId);
      // A pending invite for someone we just removed must not let them back in.
      db.prepare(
        `DELETE FROM org_invite
          WHERE org_id = ? AND accepted_at IS NULL
            AND lower(email) = (SELECT lower(email) FROM user WHERE id = ?)`,
      ).run(caller.orgId, targetId);
    });
    remove();
    res.status(204).end();
  }),
);

// ─── invitations ──────────────────────────────────────────────────────────────

/** How long an invitation link stays usable. */
const INVITE_TTL_DAYS = 14;

/**
 * The token is a bearer credential: whoever holds it can join the organization.
 * It is therefore treated exactly like a password — generated from a CSPRNG,
 * returned to the inviter ONCE, and stored only as a SHA-256 digest. A dump of
 * `org_invite` yields no usable invitation.
 *
 * SHA-256 with no salt or stretching is the right primitive here (unlike for a
 * password): the input is 256 bits of uniform randomness, so a dictionary is
 * useless and the only attack left is guessing the token itself.
 */
function newInviteToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  invited_by: string | null;
  created_at: string;
}

/**
 * Look an invitation up by the token the caller presented.
 *
 * The lookup is by DIGEST, which is what actually protects the secret: the
 * database never sees the token, so nothing about it can leak through query
 * timing or a log. The `timingSafeEqual` afterwards compares the digests rather
 * than the tokens, closing the last (theoretical) byte-by-byte comparison in the
 * path. Belt and braces, and cheap.
 */
function findInviteByToken(token: string): InviteRow | null {
  const hash = hashToken(token);
  const row = getDb().prepare("SELECT * FROM org_invite WHERE token = ?").get(hash) as
    | InviteRow
    | undefined;
  if (!row) return null;
  const a = Buffer.from(row.token, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return row;
}

function rowToInvite(r: InviteRow, now = Date.now()) {
  return {
    id: r.id,
    orgId: r.org_id,
    email: r.email,
    role: r.role,
    expiresAt: r.expires_at,
    acceptedAt: r.accepted_at,
    invitedBy: r.invited_by,
    createdAt: r.created_at,
    // Surfaced so the UI can offer "re-invite" rather than a dead link. The
    // token itself is never in this shape — it exists once, in the POST reply.
    expired: new Date(r.expires_at).getTime() <= now,
  };
}

orgMembersRouter.get(
  "/:orgId/invites",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const rows = getDb()
      .prepare(
        "SELECT * FROM org_invite WHERE org_id = ? AND accepted_at IS NULL ORDER BY created_at DESC",
      )
      .all(req.orgMembership!.orgId) as InviteRow[];
    res.json(rows.map((r) => rowToInvite(r)));
  }),
);

orgMembersRouter.post(
  "/:orgId/invites",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const body = orgInviteCreateSchema.parse(req.body);
    const db = getDb();
    const caller = req.orgMembership!;
    // Addresses are compared case-insensitively everywhere, so they are stored
    // that way — otherwise Ali@ and ali@ are two people to the invite table and
    // one person to the auth table.
    const email = body.email.trim().toLowerCase();

    if (!mayTouchRole(caller.role, body.role)) {
      res.status(403).json({ error: "owner_role_required" });
      return;
    }

    const existing = db
      .prepare(
        `SELECT m.status FROM org_member m JOIN user u ON u.id = m.user_id
          WHERE m.org_id = ? AND lower(u.email) = ?`,
      )
      .get(caller.orgId, email) as { status: string } | undefined;
    if (existing?.status === "active") {
      res.status(409).json({ error: "already_member" });
      return;
    }

    const { token, hash } = newInviteToken();
    const id = newId();
    const issue = db.transaction(() => {
      // Re-inviting the same address replaces the outstanding invitation rather
      // than adding a second one. The old token stops working immediately, which
      // is the behaviour a manager expects from "send it again" after forwarding
      // the first link to the wrong person.
      db.prepare("DELETE FROM org_invite WHERE org_id = ? AND lower(email) = ? AND accepted_at IS NULL")
        .run(caller.orgId, email);
      db.prepare(
        `INSERT INTO org_invite (id, org_id, email, role, token, expires_at, invited_by)
         VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?)`,
      ).run(id, caller.orgId, email, body.role, hash, `+${INVITE_TTL_DAYS} days`, req.user!.id);
    });
    issue();

    const row = db.prepare("SELECT * FROM org_invite WHERE id = ?").get(id) as InviteRow;
    res.status(201).json({
      invite: rowToInvite(row),
      // The one and only time the token leaves the server. The invitee has no
      // account yet in the common case, so there is nobody to mail it to from
      // here — the manager sends the link themselves.
      token,
      // The token rides in the URL FRAGMENT: fragments are never sent to a
      // server, so this link cannot end up in our access log, in a proxy's, or
      // in a Referer header on the way to a third party.
      acceptUrl: `${config.APP_BASE_URL}/fleet/invite#token=${encodeURIComponent(token)}`,
    });
  }),
);

orgMembersRouter.delete(
  "/:orgId/invites/:id",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const caller = req.orgMembership!;
    const row = db
      .prepare("SELECT role FROM org_invite WHERE id = ? AND org_id = ?")
      .get(req.params.id, caller.orgId) as { role: OrgRole } | undefined;
    if (!row) {
      res.status(404).json({ error: "invite_not_found" });
      return;
    }
    if (!mayTouchRole(caller.role, row.role)) {
      res.status(403).json({ error: "owner_role_required" });
      return;
    }
    // Revocation is a delete, not a flag: a revoked invitation must be
    // indistinguishable from one that never existed, so a leaked link tells its
    // holder nothing about the organization it was for.
    db.prepare("DELETE FROM org_invite WHERE id = ? AND org_id = ?").run(req.params.id, caller.orgId);
    res.status(204).end();
  }),
);

// ─── redeeming an invitation ──────────────────────────────────────────────────

/**
 * The invitee's side of the flow, keyed by token rather than by org — the whole
 * point is that the caller is not a member yet, so `requireOrgRole` cannot apply.
 *
 * The token travels in the BODY, never in the path or query string, so it stays
 * out of morgan's access log, out of any proxy's, and out of `Referer`.
 *
 * Sign-in is required even to preview. An invitee with no account signs up
 * first, which they must do to accept anyway; in exchange the endpoint is not an
 * unauthenticated oracle, and it can tell the caller whether the invitation is
 * actually addressed to the account they are signed in as.
 */
export const orgInvitesRouter: Router = Router();
orgInvitesRouter.use(requireUser);

/**
 * Resolve a presented token to a usable invitation, or answer with the reason it
 * is not usable and return null.
 *
 * The 404 for an unknown token is load-bearing: it is the same answer for a
 * typo, a revoked invitation and a guess, so nothing about which organizations
 * exist can be learned by trying tokens.
 */
function resolveInvite(
  token: string,
  res: import("express").Response,
): (InviteRow & { orgName: string; orgMode: "rental" | "fleet" }) | null {
  const invite = findInviteByToken(token);
  if (!invite) {
    res.status(404).json({ error: "invite_not_found" });
    return null;
  }
  if (invite.accepted_at !== null) {
    res.status(409).json({ error: "invite_already_accepted" });
    return null;
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    res.status(410).json({ error: "invite_expired" });
    return null;
  }
  const org = getDb()
    .prepare("SELECT name, mode FROM organization WHERE id = ?")
    .get(invite.org_id) as { name: string; mode: "rental" | "fleet" } | undefined;
  if (!org) {
    // The org was dissolved under the invitation (last member closed their
    // account). Same answer as a bad token — there is nothing to join.
    res.status(404).json({ error: "invite_not_found" });
    return null;
  }
  return { ...invite, orgName: org.name, orgMode: org.mode };
}

orgInvitesRouter.post(
  "/preview",
  asyncHandler(async (req, res) => {
    const { token } = orgInviteAcceptSchema.parse(req.body);
    const invite = resolveInvite(token, res);
    if (!invite) return;
    res.json({
      orgName: invite.orgName,
      mode: invite.orgMode,
      role: invite.role,
      email: invite.email,
      expiresAt: invite.expires_at,
      // Lets the UI say "this invitation is for ali@… — you are signed in as
      // veli@…" instead of showing a Join button that will 403.
      emailMatches: invite.email === (req.user!.email ?? "").trim().toLowerCase(),
    });
  }),
);

orgInvitesRouter.post(
  "/accept",
  asyncHandler(async (req, res) => {
    const { token } = orgInviteAcceptSchema.parse(req.body);
    const db = getDb();
    const invite = resolveInvite(token, res);
    if (!invite) return;

    // An invitation is addressed to an ADDRESS, not to whoever opens the link.
    // Without this check a forwarded (or intercepted) link is a free membership
    // for a stranger, and the audit trail would name the wrong person.
    if (invite.email !== (req.user!.email ?? "").trim().toLowerCase()) {
      res.status(403).json({ error: "invite_email_mismatch" });
      return;
    }

    const current = db
      .prepare("SELECT status FROM org_member WHERE org_id = ? AND user_id = ?")
      .get(invite.org_id, req.user!.id) as { status: string } | undefined;
    if (current?.status === "active") {
      res.status(409).json({ error: "already_member" });
      return;
    }

    const join = db.transaction(() => {
      // A previously removed member re-joins on the invited role with a fresh
      // joined_at; their history (which vehicle they drove, which contract they
      // signed) still resolves through the same row.
      db.prepare(
        `INSERT INTO org_member (org_id, user_id, role, status, joined_at)
         VALUES (?, ?, ?, 'active', datetime('now'))
         ON CONFLICT(org_id, user_id) DO UPDATE SET
           role = excluded.role, status = 'active', joined_at = excluded.joined_at`,
      ).run(invite.org_id, req.user!.id, invite.role);
      // Single-use: burning it here means a link that has been forwarded after
      // acceptance is dead, and a replayed request is a no-op.
      db.prepare("UPDATE org_invite SET accepted_at = datetime('now') WHERE id = ? AND accepted_at IS NULL")
        .run(invite.id);
    });
    join();

    res.json({
      orgId: invite.org_id,
      name: invite.orgName,
      mode: invite.orgMode,
      role: invite.role,
    });
  }),
);
