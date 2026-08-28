import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import {
  CLAIM_RESPONSE_DAYS,
  MAX_SHARE_GROUPS,
  MAX_SHARE_MEMBERS,
  claimApproveSchema,
  claimCreateSchema,
  orgRoleForShareRole,
  shareAcceptSchema,
  shareGroupAddVehicleSchema,
  shareGroupCreateSchema,
  shareGroupUpdateSchema,
  shareInviteCreateSchema,
  shareRoleForOrgRole,
  vehicleShareCreateSchema,
  type ClaimKind,
  type ClaimStatus,
  type IdentityKind,
  type IncomingClaim,
  type OrgRole,
  type OutgoingClaim,
  type ShareGroup,
  type ShareInvitePreview,
  type ShareMember,
} from "@mototracker/shared";
import {
  approversOfBike,
  canDecideClaims,
  requirePersonalGroupRole,
  userOrgs,
} from "../lib/orgAccess.js";
import { canAddVehicle } from "../lib/entitlement.js";
import { consumeClaimToken, readClaimToken } from "../lib/vehicleIdentity.js";
import { handoverVehicle } from "../lib/vehicleHandover.js";
import { claimLimiter, shareInviteLimiter } from "../lib/shareLimits.js";

/**
 * Sharing a garage, and handing a vehicle over.
 *
 * ── WHY THERE IS NO NEW PERMISSION MODEL HERE ────────────────────────────────
 *
 * A personal garage group IS an `organization` in `mode: 'personal'`. Membership,
 * roles, invitations and cross-tenant isolation are the machinery the fleet
 * product already uses, already tested, and already honoured by every read path
 * in the API — including the composite foreign key that makes attaching a record
 * across tenants structurally impossible. A second sharing system would have
 * been a second permission model that every future route had to remember. There
 * is one, in `lib/orgAccess.ts`, and this file only ever calls it.
 *
 * ── WHY A SINGLE-VEHICLE SHARE IS ALSO A GROUP ───────────────────────────────
 *
 * "Share my garage with my wife" and "share this bike with my mechanic" are the
 * same relationship at two sizes. `POST /vehicles/:bikeId/share` is therefore
 * not a different mechanism: it creates a one-vehicle group, names it after the
 * vehicle, and invites one person. The user sees "shared with Ahmet"; the
 * database sees the same rows as any other group. The alternative — a
 * `vehicle_share` table beside `org_member` — would have needed every scope,
 * every guard and every list query to consult two sources of truth, and the two
 * could never have been merged once a one-vehicle share needed a second vehicle.
 *
 * ── WHY THESE ROUTES ARE NOT UNDER /api/orgs ─────────────────────────────────
 *
 * Because a personal group must be unreachable from the fleet API and vice
 * versa. `requireOrgRole` now refuses personal groups and
 * `requirePersonalGroupRole` refuses business ones, so the wall is enforced in
 * the guard rather than by hoping no route is ever mounted on the wrong prefix.
 * Concretely, that is what stops a garage group calling `PATCH /api/orgs/:id`
 * to set `mode: 'fleet'` and letting itself into a product that is sold offline
 * and must never be acquirable in-app (docs/fleet-design.md §1).
 */
export const vehicleSharesRouter: Router = Router();
vehicleSharesRouter.use(requireUser);

const INVITE_TTL_DAYS = 14;

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * The invite token is a bearer credential — whoever holds it joins the group —
 * so it is treated exactly like the fleet's: generated from a CSPRNG, returned
 * to the inviter once, and stored only as a SHA-256 digest. A dump of
 * `org_invite` yields no usable invitation. (SHA-256 unsalted is the right
 * primitive: the input is 256 bits of uniform randomness, so there is no
 * dictionary to build and the only attack left is guessing the token.)
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newInviteToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

interface GroupRow {
  id: string;
  name: string;
  created_at: string;
}

function groupSummary(orgId: string, role: OrgRole): ShareGroup {
  const db = getDb();
  const org = db
    .prepare("SELECT id, name, created_at FROM organization WHERE id = ?")
    .get(orgId) as GroupRow;
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM bike WHERE org_id = ? AND archived = 0) AS vehicles,
              (SELECT COUNT(*) FROM org_member WHERE org_id = ? AND status = 'active') AS members`,
    )
    .get(orgId, orgId) as { vehicles: number; members: number };
  return {
    id: org.id,
    name: org.name,
    role: shareRoleForOrgRole(role),
    vehicleCount: counts.vehicles,
    memberCount: counts.members,
    createdAt: org.created_at,
  };
}

/** Active owners of a group. The number the last-owner guard protects. */
function activeOwnerCount(orgId: string): number {
  return (
    getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM org_member WHERE org_id = ? AND role = 'owner' AND status = 'active'",
      )
      .get(orgId) as { n: number }
  ).n;
}

// ─── groups ───────────────────────────────────────────────────────────────────

/** Every personal group the caller belongs to. Business orgs are not listed. */
vehicleSharesRouter.get(
  "/groups",
  asyncHandler(async (req, res) => {
    const groups = userOrgs(req.user!.id)
      .filter((o) => o.mode === "personal")
      .map((o) => groupSummary(o.orgId, o.role));
    res.json(groups);
  }),
);

/**
 * Create a personal group. THIS IS THE ONLY ROUTE IN THE APP THAT CREATES AN
 * ORGANIZATION, and it can only ever create a personal one.
 *
 * `is_personal = 1` is hard-coded, `mode` is written as a constant, and
 * `max_vehicles` is 0 because a personal group has no ceiling of its own — its
 * vehicles are charged to their custodians (lib/entitlement.ts). There is no
 * request field for any of the three, so no client can influence them.
 *
 * `POST /api/orgs` still does not exist, and must not: fleet organizations are
 * provisioned by the operator after a contract is signed, and an in-app path to
 * one would be the "call to action directing customers to a purchasing mechanism
 * other than IAP" that App Review 3.1.1 forbids. A garage group is a consumer
 * feature that costs nothing and unlocks nothing, so it is a different question.
 */
vehicleSharesRouter.post(
  "/groups",
  asyncHandler(async (req, res) => {
    const body = shareGroupCreateSchema.parse(req.body);
    const db = getDb();
    const mine = userOrgs(req.user!.id, db).filter(
      (o) => o.mode === "personal" && o.role === "owner",
    );
    if (mine.length >= MAX_SHARE_GROUPS) {
      res.status(403).json({ error: "share_group_limit_reached" });
      return;
    }
    const id = newId();
    const create = db.transaction(() => {
      db.prepare(
        // `mode` still has to satisfy the CHECK from 021; it is meaningless for a
        // personal group and never read (orgAccess.orgMode composes 'personal'
        // from is_personal). See 027_*.sql for why the CHECK was not altered.
        "INSERT INTO organization (id, name, mode, is_personal, max_vehicles) VALUES (?, ?, 'fleet', 1, 0)",
      ).run(id, body.name);
      db.prepare("INSERT INTO org_member (org_id, user_id, role) VALUES (?, ?, 'owner')").run(
        id,
        req.user!.id,
      );
    });
    create();
    res.status(201).json(groupSummary(id, "owner"));
  }),
);

vehicleSharesRouter.patch(
  "/groups/:groupId",
  requirePersonalGroupRole("owner"),
  asyncHandler(async (req, res) => {
    const body = shareGroupUpdateSchema.parse(req.body);
    const orgId = req.orgMembership!.orgId;
    getDb()
      .prepare("UPDATE organization SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(body.name, orgId);
    res.json(groupSummary(orgId, req.orgMembership!.role));
  }),
);

/**
 * Delete a group. Every vehicle goes HOME to its custodian rather than being
 * deleted — the group was a lens on other people's cars, not a container that
 * owns them. Doing it any other way would mean the group's owner could destroy a
 * member's vehicle and its whole history by leaving.
 */
vehicleSharesRouter.delete(
  "/groups/:groupId",
  requirePersonalGroupRole("owner"),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const orgId = req.orgMembership!.orgId;
    const remove = db.transaction(() => {
      db.prepare("UPDATE bike SET org_id = NULL, updated_at = datetime('now') WHERE org_id = ?").run(
        orgId,
      );
      // CASCADE from organization(id) clears org_member and org_invite.
      db.prepare("DELETE FROM organization WHERE id = ?").run(orgId);
    });
    remove();
    res.status(204).end();
  }),
);

// ─── members ──────────────────────────────────────────────────────────────────

vehicleSharesRouter.get(
  "/groups/:groupId/members",
  requirePersonalGroupRole(),
  asyncHandler(async (req, res) => {
    const orgId = req.orgMembership!.orgId;
    const rows = getDb()
      .prepare(
        `SELECT m.user_id, m.role, m.joined_at, u.email, u.name
           FROM org_member m
           JOIN user u ON u.id = m.user_id
          WHERE m.org_id = ? AND m.status = 'active'
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, u.email ASC`,
      )
      .all(orgId) as {
      user_id: string;
      role: OrgRole;
      joined_at: string;
      email: string | null;
      name: string | null;
    }[];
    const members: ShareMember[] = rows.map((r) => ({
      userId: r.user_id,
      role: shareRoleForOrgRole(r.role),
      email: r.email,
      name: r.name,
      joinedAt: r.joined_at,
      isSelf: r.user_id === req.user!.id,
    }));
    res.json(members);
  }),
);

/**
 * Remove someone, or leave yourself.
 *
 * Leaving is deliberately open to everyone: nobody should need permission to
 * stop sharing their data with a group. Removing SOMEBODY ELSE is the owner's
 * act alone — a member cannot evict the person who built the garage, and the
 * last-owner guard means a group can never be left with nobody who can manage it.
 *
 * Any vehicle the departing person was custodian of goes back to their own
 * garage: their car does not stay behind in a group they have left.
 */
vehicleSharesRouter.delete(
  "/groups/:groupId/members/:userId",
  requirePersonalGroupRole(),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const orgId = req.orgMembership!.orgId;
    const targetId = req.params.userId!;
    const isSelf = targetId === req.user!.id;
    if (!isSelf && req.orgMembership!.role !== "owner") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const target = db
      .prepare("SELECT role, status FROM org_member WHERE org_id = ? AND user_id = ?")
      .get(orgId, targetId) as { role: OrgRole; status: string } | undefined;
    if (!target || target.status !== "active") {
      res.status(404).json({ error: "share_member_not_found" });
      return;
    }
    if (target.role === "owner" && activeOwnerCount(orgId) <= 1) {
      // The owner leaves by deleting the group, which sends every vehicle home.
      res.status(409).json({ error: "share_last_owner" });
      return;
    }
    const remove = db.transaction(() => {
      db.prepare("UPDATE org_member SET status = 'removed' WHERE org_id = ? AND user_id = ?").run(
        orgId,
        targetId,
      );
      db.prepare(
        "UPDATE bike SET org_id = NULL, updated_at = datetime('now') WHERE org_id = ? AND user_id = ?",
      ).run(orgId, targetId);
      // A pending invite for someone just removed must not let them back in.
      db.prepare(
        `DELETE FROM org_invite
          WHERE org_id = ? AND accepted_at IS NULL
            AND lower(email) = (SELECT lower(email) FROM user WHERE id = ?)`,
      ).run(orgId, targetId);
    });
    remove();
    res.status(204).end();
  }),
);

// ─── invitations ──────────────────────────────────────────────────────────────

function createInvite(
  orgId: string,
  email: string,
  role: OrgRole,
  invitedBy: string,
): { id: string; token: string; expiresAt: string } {
  const db = getDb();
  const { token, hash } = newInviteToken();
  const id = newId();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();
  db.prepare(
    `INSERT INTO org_invite (id, org_id, email, role, token, expires_at, invited_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, email.toLowerCase(), role, hash, expiresAt, invitedBy);
  return { id, token, expiresAt };
}

/**
 * Invite someone into a group.
 *
 * The response is identical whether or not the address belongs to an existing
 * account — an invite route that answered differently would be a free email
 * enumeration oracle for the whole user base.
 */
vehicleSharesRouter.post(
  "/groups/:groupId/invites",
  shareInviteLimiter,
  requirePersonalGroupRole("owner"),
  asyncHandler(async (req, res) => {
    const body = shareInviteCreateSchema.parse(req.body);
    const db = getDb();
    const orgId = req.orgMembership!.orgId;
    const { n } = db
      .prepare(
        "SELECT COUNT(*) AS n FROM org_member WHERE org_id = ? AND status = 'active'",
      )
      .get(orgId) as { n: number };
    if (n >= MAX_SHARE_MEMBERS) {
      res.status(403).json({ error: "share_member_limit_reached" });
      return;
    }
    const invite = createInvite(orgId, body.email, orgRoleForShareRole(body.role), req.user!.id);
    res.status(201).json({
      id: invite.id,
      groupId: orgId,
      email: body.email,
      role: body.role,
      expiresAt: invite.expiresAt,
      // Returned exactly once. It is never in a list response.
      token: invite.token,
    });
  }),
);

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
}

/**
 * Look an invitation up by the token presented. The lookup is by DIGEST, which
 * is what protects the secret: the database never sees the token, so nothing
 * about it can leak through a log. The constant-time compare afterwards closes
 * the last byte-by-byte comparison in the path.
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

/**
 * What an invitee is told BEFORE accepting: which garage, as what, and how many
 * vehicles are in it. Enough to make an informed decision, and nothing about the
 * vehicles themselves — the decision is about the relationship, not the cars.
 *
 * Personal groups only. A fleet invite is answered by the fleet's own route; a
 * consumer preview here must not resolve one, or the existence of a fleet would
 * leak through a link.
 */
vehicleSharesRouter.get(
  "/invites/:token",
  asyncHandler(async (req, res) => {
    const invite = findInviteByToken(req.params.token!);
    const db = getDb();
    if (!invite) {
      res.status(404).json({ error: "share_invite_not_found" });
      return;
    }
    const org = db
      .prepare("SELECT name, is_personal FROM organization WHERE id = ?")
      .get(invite.org_id) as { name: string; is_personal: number } | undefined;
    if (!org || org.is_personal !== 1) {
      res.status(404).json({ error: "share_invite_not_found" });
      return;
    }
    if (invite.accepted_at || new Date(invite.expires_at).getTime() <= Date.now()) {
      res.status(410).json({ error: "share_invite_expired" });
      return;
    }
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM bike WHERE org_id = ? AND archived = 0")
      .get(invite.org_id) as { n: number };
    const member = db
      .prepare(
        "SELECT 1 AS ok FROM org_member WHERE org_id = ? AND user_id = ? AND status = 'active'",
      )
      .get(invite.org_id, req.user!.id) as { ok: number } | undefined;
    const preview: ShareInvitePreview = {
      groupName: org.name,
      role: shareRoleForOrgRole(invite.role),
      vehicleCount: n,
      expiresAt: invite.expires_at,
      alreadyMember: !!member,
    };
    res.json(preview);
  }),
);

vehicleSharesRouter.post(
  "/invites/accept",
  asyncHandler(async (req, res) => {
    const { token } = shareAcceptSchema.parse(req.body);
    const db = getDb();
    const invite = findInviteByToken(token);
    if (!invite) {
      res.status(404).json({ error: "share_invite_not_found" });
      return;
    }
    const org = db
      .prepare("SELECT is_personal FROM organization WHERE id = ?")
      .get(invite.org_id) as { is_personal: number } | undefined;
    if (!org || org.is_personal !== 1) {
      // A fleet invite is not acceptable here. Same 404 as an unknown token: the
      // consumer API must not confirm that a fleet invitation exists.
      res.status(404).json({ error: "share_invite_not_found" });
      return;
    }
    if (invite.accepted_at || new Date(invite.expires_at).getTime() <= Date.now()) {
      res.status(410).json({ error: "share_invite_expired" });
      return;
    }
    // The invitation is addressed to a person, not to whoever opens the link.
    // Without this an intercepted link would be a free membership.
    const email = (req.user!.email ?? "").toLowerCase();
    if (email !== invite.email.toLowerCase()) {
      res.status(403).json({ error: "share_invite_email_mismatch" });
      return;
    }
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM org_member WHERE org_id = ? AND status = 'active'")
      .get(invite.org_id) as { n: number };
    if (n >= MAX_SHARE_MEMBERS) {
      res.status(403).json({ error: "share_member_limit_reached" });
      return;
    }
    const accept = db.transaction(() => {
      db.prepare(
        `INSERT INTO org_member (org_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role, status = 'active'`,
      ).run(invite.org_id, req.user!.id, invite.role);
      db.prepare("UPDATE org_invite SET accepted_at = datetime('now') WHERE id = ?").run(invite.id);
    });
    accept();
    res.status(201).json(groupSummary(invite.org_id, invite.role));
  }),
);

// ─── vehicles in a group ──────────────────────────────────────────────────────

/**
 * Put one of MY vehicles into a group.
 *
 * Custodian-only, and that is the important line: a member cannot drag somebody
 * else's car into a garage, and — because `bike.user_id` is left alone — the
 * vehicle keeps costing its custodian a slot. Sharing changes who can see a
 * vehicle; it never changes who pays for it (lib/entitlement.ts).
 */
vehicleSharesRouter.post(
  "/groups/:groupId/vehicles",
  requirePersonalGroupRole("owner", "staff"),
  asyncHandler(async (req, res) => {
    const body = shareGroupAddVehicleSchema.parse(req.body);
    const db = getDb();
    const orgId = req.orgMembership!.orgId;
    const bike = db
      .prepare("SELECT id, user_id, org_id FROM bike WHERE id = ?")
      .get(body.bikeId) as { id: string; user_id: string; org_id: string | null } | undefined;
    // Only a vehicle that is currently PERSONAL and yours. A company van cannot
    // be moved into a family garage: it would take the org's records with it and
    // hand them to people the org never approved.
    if (!bike || bike.user_id !== req.user!.id || bike.org_id !== null) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    db.prepare("UPDATE bike SET org_id = ?, updated_at = datetime('now') WHERE id = ?").run(
      orgId,
      bike.id,
    );
    res.status(204).end();
  }),
);

/** Take a vehicle back out. The custodian always can; so can the group's owner. */
vehicleSharesRouter.delete(
  "/groups/:groupId/vehicles/:bikeId",
  requirePersonalGroupRole(),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const orgId = req.orgMembership!.orgId;
    const bike = db
      .prepare("SELECT id, user_id FROM bike WHERE id = ? AND org_id = ?")
      .get(req.params.bikeId, orgId) as { id: string; user_id: string } | undefined;
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    if (bike.user_id !== req.user!.id && req.orgMembership!.role !== "owner") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    db.prepare("UPDATE bike SET org_id = NULL, updated_at = datetime('now') WHERE id = ?").run(
      bike.id,
    );
    res.status(204).end();
  }),
);

/**
 * The one-tap single-vehicle share: create a group holding just this vehicle and
 * invite one person into it. See the module note for why this is a group rather
 * than a second mechanism.
 */
vehicleSharesRouter.post(
  "/vehicles/:bikeId/share",
  shareInviteLimiter,
  asyncHandler(async (req, res) => {
    const body = vehicleShareCreateSchema.parse(req.body);
    const db = getDb();
    const bike = db
      .prepare("SELECT id, user_id, org_id, nickname FROM bike WHERE id = ?")
      .get(req.params.bikeId) as
      | { id: string; user_id: string; org_id: string | null; nickname: string }
      | undefined;
    if (!bike || bike.user_id !== req.user!.id) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const mine = userOrgs(req.user!.id, db).filter(
      (o) => o.mode === "personal" && o.role === "owner",
    );
    // Already in a group? Then this is an invitation to THAT group, not a second
    // one — a vehicle lives in one garage, and silently creating a rival group
    // would leave the user with two lists that disagree.
    const existingGroupId =
      bike.org_id && mine.some((o) => o.orgId === bike.org_id) ? bike.org_id : null;
    if (!existingGroupId && bike.org_id !== null) {
      // A business fleet's vehicle. Not shareable this way.
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!existingGroupId && mine.length >= MAX_SHARE_GROUPS) {
      res.status(403).json({ error: "share_group_limit_reached" });
      return;
    }

    let groupId = existingGroupId;
    const run = db.transaction(() => {
      if (!groupId) {
        groupId = newId();
        db.prepare(
          "INSERT INTO organization (id, name, mode, is_personal, max_vehicles) VALUES (?, ?, 'fleet', 1, 0)",
        ).run(groupId, (body.groupName ?? bike.nickname).slice(0, 80));
        db.prepare("INSERT INTO org_member (org_id, user_id, role) VALUES (?, ?, 'owner')").run(
          groupId,
          req.user!.id,
        );
        db.prepare("UPDATE bike SET org_id = ?, updated_at = datetime('now') WHERE id = ?").run(
          groupId,
          bike.id,
        );
      }
    });
    run();

    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM org_member WHERE org_id = ? AND status = 'active'")
      .get(groupId!) as { n: number };
    if (n >= MAX_SHARE_MEMBERS) {
      res.status(403).json({ error: "share_member_limit_reached" });
      return;
    }
    const invite = createInvite(
      groupId!,
      body.email,
      orgRoleForShareRole(body.role),
      req.user!.id,
    );
    res.status(201).json({
      groupId,
      id: invite.id,
      email: body.email,
      role: body.role,
      expiresAt: invite.expiresAt,
      token: invite.token,
    });
  }),
);

// ─── claims: the duplicate conversation ───────────────────────────────────────

interface ClaimRow {
  id: string;
  bike_id: string;
  requester_id: string;
  kind: ClaimKind;
  matched_on: IdentityKind;
  status: ClaimStatus;
  message: string | null;
  identifier_hint: string;
  expires_at: string;
  decided_at: string | null;
  separate_record_bike_id: string | null;
  created_at: string;
}

/**
 * A claim that nobody answered in time is `expired`, computed rather than stored
 * so it becomes true on the deadline instead of whenever a job next runs.
 */
function effectiveStatus(row: ClaimRow): ClaimStatus {
  if (row.status !== "pending") return row.status;
  return new Date(row.expires_at).getTime() <= Date.now() ? "expired" : "pending";
}

/**
 * File a claim against the vehicle a `claimToken` refers to.
 *
 * The requester never sees the bike id — they present the opaque token they were
 * given with the 409 and the server resolves it. That is what lets the whole
 * flow work without ever telling them WHICH record they collided with, let alone
 * whose it is.
 */
vehicleSharesRouter.post(
  "/claims",
  claimLimiter,
  asyncHandler(async (req, res) => {
    const body = claimCreateSchema.parse(req.body);
    const db = getDb();
    const tok = readClaimToken(db, body.claimToken, req.user!.id);
    if (!tok) {
      res.status(404).json({ error: "claim_token_invalid" });
      return;
    }
    const existing = db
      .prepare(
        "SELECT id FROM vehicle_claim WHERE bike_id = ? AND requester_id = ? AND status = 'pending'",
      )
      .get(tok.bike_id, req.user!.id) as { id: string } | undefined;
    if (existing) {
      res.status(409).json({ error: "claim_already_open" });
      return;
    }
    const id = newId();
    const expiresAt = new Date(Date.now() + CLAIM_RESPONSE_DAYS * 86400_000).toISOString();
    db.prepare(
      `INSERT INTO vehicle_claim
         (id, bike_id, requester_id, kind, matched_on, message, identifier_hint, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      tok.bike_id,
      req.user!.id,
      body.kind,
      tok.matched_on,
      body.message ?? null,
      tok.identifier_hint,
      expiresAt,
    );
    // Single-purpose: the token has done its job and must not be replayable.
    consumeClaimToken(db, body.claimToken);
    res.status(201).json({ id, status: "pending", expiresAt });
  }),
);

/** Claims awaiting MY decision — on vehicles I hold or co-own. */
vehicleSharesRouter.get(
  "/claims/incoming",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.*, b.nickname, u.email, u.name
           FROM vehicle_claim c
           JOIN bike b ON b.id = c.bike_id
           JOIN user u ON u.id = c.requester_id
          WHERE c.status = 'pending' AND c.expires_at > datetime('now')
          ORDER BY c.created_at ASC`,
      )
      .all() as (ClaimRow & { nickname: string; email: string; name: string | null })[];
    // Filtered in JS against `approversOfBike` rather than in SQL, so there is
    // exactly one definition of "who may decide this" and it lives in orgAccess.
    const out: IncomingClaim[] = rows
      .filter((r) => canDecideClaims(req.user!.id, r.bike_id, db))
      .map((r) => ({
        id: r.id,
        bikeId: r.bike_id,
        bikeNickname: r.nickname,
        kind: r.kind,
        matchedOn: r.matched_on,
        requesterName: r.name,
        requesterEmail: r.email,
        message: r.message,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    res.json(out);
  }),
);

/**
 * My own claims. Note how little comes back: the identifier I typed, whether it
 * was answered, and nothing whatsoever about the vehicle or the person holding
 * it — not even after a refusal.
 */
vehicleSharesRouter.get(
  "/claims/outgoing",
  asyncHandler(async (req, res) => {
    const rows = getDb()
      .prepare("SELECT * FROM vehicle_claim WHERE requester_id = ? ORDER BY created_at DESC LIMIT 50")
      .all(req.user!.id) as ClaimRow[];
    const out: OutgoingClaim[] = rows.map((r) => {
      const status = effectiveStatus(r);
      return {
        id: r.id,
        kind: r.kind,
        status,
        identifierHint: r.identifier_hint,
        matchedOn: r.matched_on,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        decidedAt: r.decided_at,
        // The unresponsive-holder fallback becomes available only for a PURCHASE
        // claim that timed out unanswered. A declined claim does not qualify:
        // silence is not a decision, but "no" is.
        separateRecordAvailable:
          status === "expired" && r.kind === "purchase" && r.separate_record_bike_id === null,
        separateRecordBikeId: r.separate_record_bike_id,
      };
    });
    res.json(out);
  }),
);

/** Load a claim the caller may DECIDE, or answer 404. */
function loadDecidableClaim(id: string, userId: string): ClaimRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM vehicle_claim WHERE id = ?").get(id) as ClaimRow | undefined;
  if (!row) return null;
  if (effectiveStatus(row) !== "pending") return null;
  if (!approversOfBike(row.bike_id, db).includes(userId)) return null;
  return row;
}

/**
 * Approve. Two very different outcomes behind one word, decided by the claim's
 * kind:
 *
 *   'access'   — the requester joins a group holding this vehicle, as a guest by
 *                default. Defaulting to the LEAST access is the whole point:
 *                approving a stranger's request should not hand over your
 *                journey log because you tapped the obvious button.
 *   'purchase' — a handover. The vehicle and its factual history move; the
 *                seller's trips, fuel logs and documents stay with the seller
 *                (lib/vehicleHandover.ts).
 */
vehicleSharesRouter.post(
  "/claims/:id/approve",
  asyncHandler(async (req, res) => {
    const body = claimApproveSchema.parse(req.body ?? {});
    const db = getDb();
    const claim = loadDecidableClaim(req.params.id!, req.user!.id);
    if (!claim) {
      res.status(404).json({ error: "claim_not_found" });
      return;
    }

    if (claim.kind === "purchase") {
      const result = handoverVehicle({
        db,
        bikeId: claim.bike_id,
        toUserId: claim.requester_id,
        claimId: claim.id,
        source: "claim_approved",
      });
      if (!result.ok) {
        // `vehicle_limit_reached` here is the BUYER's ceiling, not the approver's
        // — reported honestly so the holder knows why nothing happened rather
        // than being told their own garage is full.
        res.status(result.error === "vehicle_limit_reached" ? 409 : 404).json({
          error: result.error === "vehicle_limit_reached" ? "recipient_limit_reached" : result.error,
        });
        return;
      }
      db.prepare(
        "UPDATE vehicle_claim SET status = 'approved', decided_at = datetime('now'), decided_by = ? WHERE id = ?",
      ).run(req.user!.id, claim.id);
      res.json({ id: claim.id, status: "approved", handoverId: result.handoverId });
      return;
    }

    // ── access: share the vehicle rather than give it away ──────────────────
    const bike = db
      .prepare("SELECT id, user_id, org_id, nickname FROM bike WHERE id = ?")
      .get(claim.bike_id) as
      | { id: string; user_id: string; org_id: string | null; nickname: string }
      | undefined;
    if (!bike) {
      res.status(404).json({ error: "claim_not_found" });
      return;
    }
    // A business fleet's vehicle is never shared into a consumer group: that
    // would put an outsider inside an organization's tenancy. A fleet that wants
    // to hand a vehicle over does it by approving a PURCHASE claim.
    if (bike.org_id !== null && !isPersonalOrg(bike.org_id)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    let groupId = bike.org_id;
    const role = orgRoleForShareRole(body.role);
    const approve = db.transaction(() => {
      if (!groupId) {
        groupId = newId();
        db.prepare(
          "INSERT INTO organization (id, name, mode, is_personal, max_vehicles) VALUES (?, ?, 'fleet', 1, 0)",
        ).run(groupId, bike.nickname.slice(0, 80));
        db.prepare("INSERT INTO org_member (org_id, user_id, role) VALUES (?, ?, 'owner')").run(
          groupId,
          bike.user_id,
        );
        db.prepare("UPDATE bike SET org_id = ?, updated_at = datetime('now') WHERE id = ?").run(
          groupId,
          bike.id,
        );
      }
      db.prepare(
        `INSERT INTO org_member (org_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role, status = 'active'`,
      ).run(groupId, claim.requester_id, role);
      db.prepare(
        "UPDATE vehicle_claim SET status = 'approved', decided_at = datetime('now'), decided_by = ? WHERE id = ?",
      ).run(req.user!.id, claim.id);
    });
    approve();
    res.json({ id: claim.id, status: "approved", groupId });
  }),
);

function isPersonalOrg(orgId: string): boolean {
  const row = getDb()
    .prepare("SELECT is_personal FROM organization WHERE id = ?")
    .get(orgId) as { is_personal: number } | undefined;
  return row?.is_personal === 1;
}

vehicleSharesRouter.post(
  "/claims/:id/decline",
  asyncHandler(async (req, res) => {
    const claim = loadDecidableClaim(req.params.id!, req.user!.id);
    if (!claim) {
      res.status(404).json({ error: "claim_not_found" });
      return;
    }
    getDb()
      .prepare(
        "UPDATE vehicle_claim SET status = 'declined', decided_at = datetime('now'), decided_by = ? WHERE id = ?",
      )
      .run(req.user!.id, claim.id);
    res.json({ id: claim.id, status: "declined" });
  }),
);

/** Withdraw my own claim. */
vehicleSharesRouter.post(
  "/claims/:id/withdraw",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM vehicle_claim WHERE id = ? AND requester_id = ?")
      .get(req.params.id, req.user!.id) as ClaimRow | undefined;
    if (!row || effectiveStatus(row) !== "pending") {
      res.status(404).json({ error: "claim_not_found" });
      return;
    }
    db.prepare(
      "UPDATE vehicle_claim SET status = 'withdrawn', decided_at = datetime('now') WHERE id = ?",
    ).run(row.id);
    res.status(204).end();
  }),
);

/**
 * THE UNRESPONSIVE-HOLDER CASE. A real buyer whose seller deleted the app, or
 * simply never opens it, must not be locked out of tracking their own car.
 *
 * What this route is NOT: an automatic transfer. There is no timer anywhere that
 * moves a vehicle without a human saying yes, and there must not be — a VIN is
 * readable through a windscreen at arm's length, so a design where silence
 * eventually equals consent would let anybody who walked past a car take its
 * record. A holder on a three-week holiday would lose their vehicle.
 *
 * What it IS: after CLAIM_RESPONSE_DAYS with no answer, the claimant may start
 * their OWN record of the vehicle. It is a normal vehicle in every way, charged
 * to their own ceiling, except that it does NOT take the identity — the registry
 * entry stays with the incumbent, and this row is marked as contesting it. So:
 *
 *   - nobody loses anything: the incumbent's record, history and documents are
 *     untouched;
 *   - the buyer gets a working app today rather than a support ticket;
 *   - the duplicate is deliberate and recorded, so it can be reconciled later —
 *     if the incumbent ever answers, the histories can be merged by hand;
 *   - it cannot be used to bypass the uniqueness rule at scale: it costs a
 *     21-day-old unanswered claim and a vehicle slot, per vehicle.
 */
vehicleSharesRouter.post(
  "/claims/:id/separate-record",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM vehicle_claim WHERE id = ? AND requester_id = ?")
      .get(req.params.id, req.user!.id) as ClaimRow | undefined;
    if (!row) {
      res.status(404).json({ error: "claim_not_found" });
      return;
    }
    if (effectiveStatus(row) !== "expired" || row.kind !== "purchase") {
      // A declined claim never reaches here: the holder said no, and no is an
      // answer. Only silence earns the fallback.
      res.status(409).json({ error: "claim_not_expired" });
      return;
    }
    if (row.separate_record_bike_id) {
      res.status(409).json({ error: "separate_record_exists" });
      return;
    }
    if (!canAddVehicle(req.user!.id, db)) {
      res.status(403).json({ error: "vehicle_limit_reached" });
      return;
    }
    // Copied from the CLAIM, not from the incumbent's record: the only thing the
    // claimant is given back is the identifier they typed themselves. They learn
    // nothing new about the vehicle they collided with.
    const id = newId();
    const isChassis = row.matched_on === "chassis";
    const create = db.transaction(() => {
      db.prepare(
        `INSERT INTO bike (id, user_id, vehicle_type, nickname, chassis_no, engine_no)
         VALUES (?, ?, 'car', ?, ?, ?)`,
      ).run(
        id,
        req.user!.id,
        row.identifier_hint.slice(0, 12),
        isChassis ? row.identifier_hint : null,
        isChassis ? null : row.identifier_hint,
      );
      // NO identity registration. The registry entry stays with the incumbent —
      // that is the whole difference between this and an approved handover.
      db.prepare("UPDATE vehicle_claim SET separate_record_bike_id = ? WHERE id = ?").run(id, row.id);
    });
    create();
    res.status(201).json({ bikeId: id, identityContested: true });
  }),
);

/**
 * A holder GIVING a vehicle away, without waiting to be asked — "I sold this
 * car and here is the buyer's email". The mirror image of an approved purchase
 * claim, and it moves exactly the same things.
 */
const handoverSchema = z.object({ email: z.string().email() });

vehicleSharesRouter.post(
  "/vehicles/:bikeId/handover",
  asyncHandler(async (req, res) => {
    const body = handoverSchema.parse(req.body);
    const db = getDb();
    if (!canDecideClaims(req.user!.id, req.params.bikeId!, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const recipient = db
      .prepare("SELECT id FROM user WHERE lower(email) = ?")
      .get(body.email.toLowerCase()) as { id: string } | undefined;
    if (!recipient) {
      // The one place this API tells you whether an address has an account, and
      // it is unavoidable: there is nobody to hand the vehicle to. It is gated
      // behind holding the vehicle, so it is not a general-purpose oracle.
      res.status(404).json({ error: "recipient_not_found" });
      return;
    }
    const result = handoverVehicle({
      db,
      bikeId: req.params.bikeId!,
      toUserId: recipient.id,
      source: "holder_initiated",
    });
    if (!result.ok) {
      res.status(result.error === "vehicle_limit_reached" ? 409 : 400).json({
        error: result.error === "vehicle_limit_reached" ? "recipient_limit_reached" : result.error,
      });
      return;
    }
    res.json({ handoverId: result.handoverId });
  }),
);
