-- ===== Organizations: the multi-tenant foundation =====
--
-- Garajım stays a single-user consumer app by default. An ORGANIZATION is the
-- opt-in business layer on top of it: a garage/company whose vehicles are shared
-- by several members instead of belonging to one person. One product, two modes
-- chosen once per org:
--
--   'rental' — they rent vehicles OUT to customers (fleet_customer +
--              rental_contract carry the handover/return odometer and the money).
--   'fleet'  — they operate their own fleet, and vehicles are handed to employee
--              drivers (vehicle_assignment).
--
-- A user can belong to several orgs AND still own personal vehicles; the two
-- worlds are kept apart by exactly one column: `bike.org_id`. NULL means
-- "personal vehicle, visible only to bike.user_id" — which is every row that
-- exists today, so nothing changes for existing users.
--
-- Every read/write decision derived from these tables lives in ONE place,
-- src/lib/orgAccess.ts. Routes never write ownership SQL of their own.

CREATE TABLE IF NOT EXISTS organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Chosen at creation and effectively permanent: it decides which half of the
  -- product (contracts vs. assignments) the org sees.
  mode TEXT NOT NULL CHECK (mode IN ('rental','fleet')),
  -- Active-vehicle ceiling for the ORG, independent of any member's personal
  -- entitlement. Defaults to 1 to mirror the consumer free tier; a fleet IAP
  -- tier raises it (see lib/entitlement.ts → setOrgMaxVehicles).
  max_vehicles INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Membership. `status` is kept (rather than deleting the row) so a removed
-- member's history — who assigned which vehicle, who signed which contract —
-- still resolves to a name, while access is revoked immediately: every access
-- check requires status = 'active'.
CREATE TABLE IF NOT EXISTS org_member (
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- owner   — everything, including billing and deleting the org
  -- manager — everything operational: vehicles, members, contracts
  -- staff   — day-to-day records on every org vehicle, but no vehicle deletion,
  --           no member management, no billing
  -- driver  — ONLY the vehicles currently assigned to them; must never be able
  --           to enumerate the rest of the fleet
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff','driver')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, user_id)
);
-- Drives userOrgs() and every "which orgs can this caller see?" lookup, which
-- runs on essentially every authenticated request.
CREATE INDEX IF NOT EXISTS idx_org_member_user ON org_member(user_id, status);

-- Pending invitations. The token is the capability — it is the only thing the
-- invitee has, so it is UNIQUE and carries its own expiry.
CREATE TABLE IF NOT EXISTS org_invite (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff','driver')),
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  -- SET NULL, not CASCADE: the manager who sent an invite may delete their
  -- account before it is accepted; that must not silently revoke the invite.
  invited_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_org_invite_org ON org_invite(org_id, accepted_at);
CREATE INDEX IF NOT EXISTS idx_org_invite_email ON org_invite(email);

-- ===== The one column that makes a vehicle organizational =====
--
-- NULL (the value every existing row gets) = personal vehicle, unchanged
-- semantics: only bike.user_id may see it, and it counts against that user's
-- personal entitlement. NON-NULL = org vehicle: visibility comes from
-- org_member/vehicle_assignment, and the ceiling comes from
-- organization.max_vehicles.
--
-- `bike.user_id` stays NOT NULL and keeps cascading from user(id), but for an
-- ORG vehicle it no longer means "the only person who may see this". It means
-- CUSTODIAN: the member who registered the row. Access is decided by org
-- membership; custody exists only so the row has a valid owner for the FK and a
-- sensible "created by". The trigger at the bottom of this file keeps custody
-- valid when a member deletes their account.
ALTER TABLE bike ADD COLUMN org_id TEXT REFERENCES organization(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_bike_org ON bike(org_id, archived);

-- Parent key for the composite foreign keys below. Pairing (id, org_id) lets
-- SQLite reject an assignment or contract that points at ANOTHER org's vehicle —
-- a cross-tenant leak that would otherwise depend on application code alone.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bike_id_org ON bike(id, org_id);

-- ===== fleet mode: vehicle → driver =====
--
-- An OPEN row (ended_at IS NULL) is what grants a driver access. Closing it is
-- the revocation: the driver loses the vehicle the instant ended_at is set, with
-- no cache to invalidate anywhere.
CREATE TABLE IF NOT EXISTS vehicle_assignment (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  bike_id TEXT NOT NULL,
  -- The driver. CASCADE: an assignment is a fact about a person, so it goes when
  -- that person deletes their account (see the account-deletion note below).
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  start_km INTEGER,
  end_km INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bike_id, org_id) REFERENCES bike(id, org_id) ON UPDATE CASCADE ON DELETE CASCADE
);
-- A vehicle can be in exactly one pair of hands at a time. A partial unique
-- index is the only way to say that in SQLite, and it makes the "hand over
-- without closing the previous assignment" bug impossible rather than unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignment_open_bike
  ON vehicle_assignment(bike_id) WHERE ended_at IS NULL;
-- The hot path: "which vehicles may this driver see right now?" — evaluated on
-- every request a driver makes.
CREATE INDEX IF NOT EXISTS idx_assignment_driver
  ON vehicle_assignment(user_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_assignment_org
  ON vehicle_assignment(org_id, ended_at);

-- ===== rental mode: customers and contracts =====
--
-- PRIVACY: fleet_customer holds the personal data of people who are NOT app
-- users (renter name, phone, email). It therefore has no user(id) FK and is not
-- reachable by DELETE /api/me; it is erased when the organization is deleted
-- (CASCADE below), and a renter's own erasure request needs an org-side route to
-- delete the customer — which cascades their contracts.
CREATE TABLE IF NOT EXISTS fleet_customer (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fleet_customer_org ON fleet_customer(org_id, name);
-- Parent key for rental_contract's composite FK — same cross-tenant guard as
-- bikes: you cannot write a contract against another org's customer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_customer_id_org ON fleet_customer(id, org_id);

CREATE TABLE IF NOT EXISTS rental_contract (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  bike_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Agreed end of the rental; returned_at is when it actually came back.
  ends_at TEXT,
  returned_at TEXT,
  handover_km INTEGER,
  return_km INTEGER,
  daily_rate REAL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','returned','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Keeps `status` and `returned_at` from disagreeing, which is what the partial
  -- unique index below trusts when it decides a vehicle is still out.
  CHECK (status <> 'open' OR returned_at IS NULL),
  FOREIGN KEY (bike_id, org_id) REFERENCES bike(id, org_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (customer_id, org_id) REFERENCES fleet_customer(id, org_id) ON UPDATE CASCADE ON DELETE CASCADE
);
-- The rental equivalent of the assignment rule: one vehicle cannot be rented to
-- two customers at once. Double-booking becomes a constraint violation instead
-- of a support ticket.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_open_bike
  ON rental_contract(bike_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_contract_org_status
  ON rental_contract(org_id, status, ends_at);
CREATE INDEX IF NOT EXISTS idx_contract_customer ON rental_contract(customer_id);

-- ===== Account deletion vs. organization data =====
--
-- DELETE /api/me (routes/me.ts) is a single `DELETE FROM user`, and every app
-- table cascades from it. That is exactly right for a consumer app and it is the
-- deletion guarantee the privacy policy makes — but with orgs it would mean the
-- member who happened to register a company van takes the van, its documents and
-- its whole service history with them when they close their account.
--
-- We refuse to choose between the two guarantees, so this BEFORE DELETE trigger
-- separates them. It runs while the user row still exists, i.e. before any FK
-- cascade fires, and it:
--
--   1. DISSOLVES orgs whose only remaining active member is the departing user.
--      Nobody is left to depend on them, so the org and everything under it
--      (vehicles, assignments, customers, contracts, invites) is deleted — the
--      deletion guarantee wins.
--   2. HANDS OVER custody of surviving org rows to another active member,
--      preferring an owner, then a manager, then staff. The rows survive for the
--      org; the departing user's identifier does not survive anywhere.
--
-- Anything with no surviving member to hand to falls through to the normal
-- cascade and is deleted with the user. Personal rows (bike.org_id IS NULL) are
-- never touched here: they always die with their owner, exactly as today.
--
-- Deliberately NOT handed over:
--   * vehicle_assignment / org_member rows — they are statements ABOUT the
--     person, so they go with them.
--   * document rows whose image lives in the departing user's upload directory.
--     routes/me.ts removes UPLOADS_DIR/<userId> wholesale, so keeping the row
--     would leave a link to a deleted file. Org-vehicle documents are written to
--     UPLOADS_DIR/org/<orgId> instead (see routes/documents.ts), which that
--     removal cannot reach — so those rows ARE handed over below.
CREATE TRIGGER IF NOT EXISTS trg_user_delete_org_handover
BEFORE DELETE ON user
BEGIN
  -- 1. Orgs the departing user is the last active member of: nothing to protect.
  DELETE FROM organization WHERE id IN (
    SELECT m.org_id FROM org_member m
     WHERE m.user_id = OLD.id
       AND m.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM org_member other
          WHERE other.org_id = m.org_id
            AND other.status = 'active'
            AND other.user_id <> OLD.id
       )
  );

  -- 2. Hand over the vehicles themselves.
  UPDATE bike
     SET user_id = (
           SELECT m.user_id FROM org_member m
            WHERE m.org_id = bike.org_id AND m.status = 'active' AND m.user_id <> OLD.id
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
                     m.joined_at ASC
            LIMIT 1),
         updated_at = datetime('now')
   WHERE user_id = OLD.id
     AND org_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM org_member m
        WHERE m.org_id = bike.org_id AND m.status = 'active' AND m.user_id <> OLD.id
     );

  -- 2b. …and every record hanging off an org vehicle. Same custodian rule,
  --     resolved through the record's bike.
  UPDATE dated_item
     SET user_id = (
           SELECT m.user_id FROM org_member m
            JOIN bike b ON b.id = dated_item.bike_id
            WHERE m.org_id = b.org_id AND m.status = 'active' AND m.user_id <> OLD.id
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
                     m.joined_at ASC
            LIMIT 1),
         updated_at = datetime('now')
   WHERE user_id = OLD.id
     AND EXISTS (
       SELECT 1 FROM org_member m JOIN bike b ON b.id = dated_item.bike_id
        WHERE b.org_id IS NOT NULL AND m.org_id = b.org_id
          AND m.status = 'active' AND m.user_id <> OLD.id
     );

  UPDATE maintenance_item
     SET user_id = (
           SELECT m.user_id FROM org_member m
            JOIN bike b ON b.id = maintenance_item.bike_id
            WHERE m.org_id = b.org_id AND m.status = 'active' AND m.user_id <> OLD.id
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
                     m.joined_at ASC
            LIMIT 1),
         updated_at = datetime('now')
   WHERE user_id = OLD.id
     AND EXISTS (
       SELECT 1 FROM org_member m JOIN bike b ON b.id = maintenance_item.bike_id
        WHERE b.org_id IS NOT NULL AND m.org_id = b.org_id
          AND m.status = 'active' AND m.user_id <> OLD.id
     );

  UPDATE fuel_log
     SET user_id = (
           SELECT m.user_id FROM org_member m
            JOIN bike b ON b.id = fuel_log.bike_id
            WHERE m.org_id = b.org_id AND m.status = 'active' AND m.user_id <> OLD.id
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
                     m.joined_at ASC
            LIMIT 1)
   WHERE user_id = OLD.id
     AND EXISTS (
       SELECT 1 FROM org_member m JOIN bike b ON b.id = fuel_log.bike_id
        WHERE b.org_id IS NOT NULL AND m.org_id = b.org_id
          AND m.status = 'active' AND m.user_id <> OLD.id
     );

  -- Trips are location history. They are handed over only because the vehicle's
  -- km/route log is the org's operational record; the recorder's identity is
  -- replaced by the custodian's, so nothing personal to the departing user stays.
  UPDATE trip
     SET user_id = (
           SELECT m.user_id FROM org_member m
            JOIN bike b ON b.id = trip.bike_id
            WHERE m.org_id = b.org_id AND m.status = 'active' AND m.user_id <> OLD.id
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
                     m.joined_at ASC
            LIMIT 1)
   WHERE user_id = OLD.id
     AND EXISTS (
       SELECT 1 FROM org_member m JOIN bike b ON b.id = trip.bike_id
        WHERE b.org_id IS NOT NULL AND m.org_id = b.org_id
          AND m.status = 'active' AND m.user_id <> OLD.id
     );

  UPDATE document
     SET user_id = (
           SELECT m.user_id FROM org_member m
            JOIN bike b ON b.id = document.bike_id
            WHERE m.org_id = b.org_id AND m.status = 'active' AND m.user_id <> OLD.id
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
                     m.joined_at ASC
            LIMIT 1),
         updated_at = datetime('now')
   WHERE user_id = OLD.id
     AND EXISTS (
       SELECT 1 FROM org_member m JOIN bike b ON b.id = document.bike_id
        WHERE b.org_id IS NOT NULL AND m.org_id = b.org_id
          AND m.status = 'active' AND m.user_id <> OLD.id
     );
END;
