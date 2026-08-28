-- ===== Vehicle groups: named collections the owner actually asked for =====
--
-- 027 built SHARING and, underneath it, a "personal group" — an `organization`
-- with `is_personal = 1`. But a group could only ever come into existence as a
-- SIDE EFFECT of inviting somebody to a vehicle. There was no way to say "these
-- three bikes are my Ducatis" without also handing a stranger a key, so the
-- feature the owner wanted ("i want to make a group as my cars or my bikes or
-- ducatis bmws etc.") did not exist at all.
--
-- This migration makes a group a thing you make, and changes ONE structural
-- decision to do it.
--
-- ─── THE DECISION: many groups per vehicle, not one ──────────────────────────
--
-- Until now a vehicle's group was `bike.org_id` — a single column, so a vehicle
-- sat in at most one group. That is the wrong shape for what was asked for. The
-- owner's own four examples are two overlapping AXES:
--
--     "my cars" / "my bikes"      — by vehicle type
--     "Ducatis" / "BMWs"          — by make
--
-- A Ducati Monster belongs in "my bikes" AND in "Ducatis". They are not
-- alternatives, and a model that forces a choice between them fails on the
-- second group the user makes. So membership becomes a JOIN TABLE and a vehicle
-- may sit in as many groups as it likes.
--
-- The rule that keeps this comprehensible, and the reason it can stay ONE
-- concept rather than splitting into "labels" and "shares":
--
--     A GROUP'S MEMBERS SEE THE GROUP'S VEHICLES.
--
-- A group with nobody in it but you is a folder. Invite somebody and the same
-- folder is a shared garage. Visibility is the UNION over a vehicle's groups,
-- which is monotonic — adding a group can only ever widen access, never narrow
-- it — so there is no combination of memberships a user has to reason about
-- backwards. A second parallel "labels" system would have been a second thing
-- to name, a second thing to teach, and a second thing every future read path
-- had to remember; and the day a label needed to be shared it could not have
-- been merged with the group it duplicated.
--
-- ─── WHAT `bike.org_id` MEANS FROM NOW ON ────────────────────────────────────
--
-- BUSINESS TENANCY, AND NOTHING ELSE. Before this migration it carried two
-- unrelated ideas at once: "this vehicle is owned by a company" and "this
-- vehicle is in a garage group". After it, `org_id` is non-NULL only for a
-- 'fleet'/'rental' organization, and every personal group lives in `bike_group`.
-- The triggers at the bottom enforce that rather than trusting the routes.
--
-- Three good things fall out of the separation, all of them structural:
--
--   1. THE ENTITLEMENT HOLE CLOSES BY CONSTRUCTION. `countActiveBikes` counts
--      `b.org_id IS NULL AND b.user_id = ?` — an ordinary personal vehicle. A
--      grouped vehicle now IS one, so it cannot fall off its custodian's
--      ceiling no matter how many groups it joins. The anti-farming rule used
--      to depend on a LEFT JOIN remembering to re-admit `is_personal = 1` rows;
--      now there is nothing to remember. (The join stays in place as a
--      belt-and-braces for any row a future bug might mis-file.)
--
--   2. THE COMPOSITE FOREIGN KEYS GET SHARPER. `vehicle_assignment` and
--      `rental_contract` reference `bike(id, org_id)`. With `org_id` meaning
--      only "business tenant", a personal vehicle's `org_id` is NULL and no
--      dispatch row can ever be written against it.
--
--   3. FLEET STAYS INVISIBLE. `requireOrgRole` still 404s a personal group and
--      `requirePersonalGroupRole` still 404s a business one; neither is touched
--      here. `bike_group` simply cannot reference a business org (trigger
--      below), so grouping offers no new path between the two products.
--
-- ─── WHY NOT A NEW `group` TABLE INSTEAD OF REUSING `organization` ───────────
--
-- Because members, roles, invitations, the invite-token digest and the
-- cross-tenant isolation are all already built, tested and honoured by every
-- read path in the API (lib/orgAccess.ts). A group needs every one of them the
-- moment it is shared. Reusing `organization` keeps ONE permission model; a new
-- table would have meant a second one, forever, for the sake of a name.

CREATE TABLE IF NOT EXISTS bike_group (
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  -- Always a PERSONAL organization. Enforced by trigger, not by convention.
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  -- Who filed it here. SET NULL rather than CASCADE: the membership is a fact
  -- about the VEHICLE, and it must not evaporate because the person who
  -- organised the garage closed their account.
  added_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- One row per (vehicle, group): adding a vehicle twice is a no-op, not a
  -- duplicate, which is what makes the "set my groups" write idempotent.
  PRIMARY KEY (bike_id, org_id)
);

-- The two directions both scans need. `(bike_id, org_id)` is the primary key,
-- so "which groups is this vehicle in?" is already covered; this index serves
-- the other one — "which vehicles are in this group?" — which is what the
-- garage filter and every group summary count run.
CREATE INDEX IF NOT EXISTS idx_bike_group_org ON bike_group(org_id);

-- ─── backfill ────────────────────────────────────────────────────────────────
--
-- Every vehicle currently filed in a personal group moves to the join table and
-- goes back to being a personal vehicle. This runs BEFORE the guard triggers are
-- created, because it is the one moment in the database's life when a row
-- legitimately violates both of them mid-flight.
--
-- Custody is preserved exactly: `bike.user_id` is not touched, so nobody's
-- entitlement count changes by a single vehicle across this migration. That is
-- the property to check if this is ever re-run against a live database — the
-- rows move, the bill does not.
INSERT OR IGNORE INTO bike_group (bike_id, org_id, added_by)
SELECT b.id, b.org_id, b.user_id
  FROM bike b
  JOIN organization o ON o.id = b.org_id
 WHERE o.is_personal = 1;

UPDATE bike
   SET org_id = NULL
 WHERE org_id IN (SELECT id FROM organization WHERE is_personal = 1);

-- ─── the invariants, as triggers ─────────────────────────────────────────────
--
-- Both of these are already true of every route that writes here. They are
-- ALSO written down as triggers because they are the two statements the whole
-- separation rests on, and a route added next year will not remember them. A
-- constraint that lives in the schema is checked whether or not the code that
-- broke it knew it existed.

-- 1. A group is always a PERSONAL organization. Without this, `bike_group`
--    would be a second, unguarded way to put an outsider inside a company's
--    tenancy — precisely what `requireOrgRole`'s 404 exists to prevent.
CREATE TRIGGER IF NOT EXISTS trg_bike_group_personal_org_ins
BEFORE INSERT ON bike_group
WHEN (SELECT is_personal FROM organization WHERE id = NEW.org_id) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'bike_group_requires_personal_group');
END;

CREATE TRIGGER IF NOT EXISTS trg_bike_group_personal_org_upd
BEFORE UPDATE OF org_id ON bike_group
WHEN (SELECT is_personal FROM organization WHERE id = NEW.org_id) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'bike_group_requires_personal_group');
END;

-- 2. Only a PERSONAL vehicle may be grouped. A company van dragged into a
--    family garage would take the organization's records with it and show them
--    to people the organization never approved. The route already refuses it
--    (routes/vehicleShares.ts answers 404); this makes the refusal structural.
CREATE TRIGGER IF NOT EXISTS trg_bike_group_personal_bike_ins
BEFORE INSERT ON bike_group
WHEN (SELECT org_id FROM bike WHERE id = NEW.bike_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'bike_group_requires_personal_vehicle');
END;

-- 3. The other direction of the same rule: a vehicle that becomes a company's
--    leaves every garage group on the way in. This is the case no route can
--    guard, because the write happens on `bike`, not on `bike_group` — a
--    handover into an org, a fleet import, an admin fix. Silently dropping the
--    group rows is the safe resolution: the alternative is a vehicle that is
--    both a company asset and visible to a household.
CREATE TRIGGER IF NOT EXISTS trg_bike_org_clears_groups
AFTER UPDATE OF org_id ON bike
WHEN NEW.org_id IS NOT NULL
BEGIN
  DELETE FROM bike_group WHERE bike_id = NEW.id;
END;
