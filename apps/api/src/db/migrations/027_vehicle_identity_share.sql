-- ===== Global vehicle identity, personal sharing groups, and handover =====
--
-- Three tables and one column, for one idea: **a vehicle is a thing in the
-- world, not a row in one person's account.** Once the database can say "these
-- two records are the same car", three features fall out of it — the app can
-- refuse to hold a vehicle twice, two people can keep one garage between them,
-- and a car that changes hands keeps its history without handing the seller's
-- private life to the buyer.

-- ─── 1. personal groups ──────────────────────────────────────────────────────
--
-- A personal garage group IS an organization. `organization` + `org_member` +
-- `org_invite` + lib/orgAccess.ts already are "a set of vehicles shared with
-- several people, with roles, invitations and cross-tenant isolation", and that
-- machinery is load-bearing and well tested — the composite FK on (id, org_id)
-- makes attaching a record across tenants structurally impossible, not merely
-- unlikely. A second, parallel sharing system would be a second permission model
-- that every read path in the app has to honour correctly, forever. There is
-- exactly one, and it lives in orgAccess.ts.
--
-- WHY A COLUMN RATHER THAN A THIRD `mode` VALUE. `organization.mode` carries
-- `CHECK (mode IN ('rental','fleet'))`, and SQLite cannot alter a CHECK
-- constraint: the documented procedure is to rebuild the table. Rebuilding
-- `organization` means dropping it, and `DROP TABLE` with foreign_keys=ON
-- performs an implicit DELETE FROM first — which would fire ON DELETE CASCADE
-- into `bike`, `org_member`, `vehicle_assignment`, `fleet_customer` and
-- `rental_contract` and delete every fleet customer's data. The pragma that
-- would prevent that cannot be changed inside a transaction, and every migration
-- here runs inside one (db/migrate.ts) — for good reason, since a half-applied
-- rebuild on the live database is unrecoverable.
--
-- So the new mode is carried additively and composed in code. `orgAccess.orgMode()`
-- is the ONE reader; it returns 'personal' when this flag is set and the stored
-- `mode` is never consulted for such a row. Every other module — including the
-- shared `OrgMode` type and `GET /api/orgs` — sees the three-valued mode it
-- expects. The cost is one indirection; the benefit is a migration that cannot
-- lose data.
ALTER TABLE organization ADD COLUMN is_personal INTEGER NOT NULL DEFAULT 0;

-- `userOrgs()` runs on essentially every authenticated request and now has to
-- report the composed mode, so the flag rides along in the membership lookup.
CREATE INDEX IF NOT EXISTS idx_org_personal ON organization(is_personal);

-- ─── 2. the identity registry ────────────────────────────────────────────────
--
-- One row per (vehicle, identifier kind). The registry — not `bike` — is what
-- makes a vehicle unique, for two reasons. A vehicle's chassis/engine fields are
-- free text that OCR fills in and users edit, so a UNIQUE constraint on the bike
-- table would reject an ordinary typo as if it were a duplicate car; and a
-- registry can hold the OCR-FOLDED match key beside the value the user actually
-- typed, which is the only way "VF1RFB00X12345678" and "VFIRFBOOX12345678" can
-- be recognised as the same vehicle.
--
-- `match_key` is the folded form (see lib/vehicleIdentity.ts): uppercased,
-- punctuation stripped, and the four standard OCR confusions collapsed —
-- O/0, I/1, S/5, B/8 — plus Q→0, which is free for a chassis because a VIN's
-- alphabet excludes I, O and Q entirely. `value` is what to show a human.
CREATE TABLE IF NOT EXISTS vehicle_identity (
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  -- Only the two identifiers that mean something.
  --
  --   chassis — the VIN. The only STABLE identity: it survives a sale, a plate
  --             change and a move between provinces.
  --   engine  — strong evidence, not proof. Engines get swapped, especially on
  --             older cars and motorcycles, so this one is deliberately NOT
  --             unique (see the indexes below): a match starts a conversation.
  --
  -- PLATE IS ABSENT, ON PURPOSE. Turkish plates are re-issued and change when a
  -- vehicle moves province, so two different cars legitimately hold the same
  -- plate at different times — a plate match is not evidence of identity. It is
  -- also the one identifier a stranger can read off a bumper, so answering
  -- "that plate is already tracked" would turn this table into a plate-to-user
  -- oracle. There is no code path that writes kind='plate' and no value for it
  -- in the CHECK, so one cannot be added by accident.
  kind TEXT NOT NULL CHECK (kind IN ('chassis','engine')),
  match_key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bike_id, kind)
);

-- THE uniqueness rule, and the only one. A chassis number belongs to exactly one
-- vehicle record in the entire system — across users, across organizations, and
-- including archived rows, because the whole point is that a sold vehicle's
-- history is still findable. Enforcing it in the schema rather than in a route
-- means a race between two simultaneous adds cannot produce a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_identity_chassis
  ON vehicle_identity(match_key) WHERE kind = 'chassis';

-- Engine numbers are indexed but NOT unique. A swapped engine legitimately
-- appears on two vehicles — on the donor until its owner updates the record, and
-- on the recipient from the moment they do. A unique index here would refuse a
-- true statement about the world; a plain index lets us treat the match as the
-- evidence it is.
CREATE INDEX IF NOT EXISTS idx_vehicle_identity_engine
  ON vehicle_identity(kind, match_key);

-- ─── 3. claims: the duplicate conversation ───────────────────────────────────
--
-- When someone adds a vehicle that is already tracked, they are told THAT it is
-- tracked and nothing else — not by whom, not its nickname, not its id. What
-- they get is the ability to knock. This table is the knock.
CREATE TABLE IF NOT EXISTS vehicle_claim (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- access   — "that is my family's car, let me in."  → creates a share.
  -- purchase — "I bought this vehicle."               → performs a handover.
  kind TEXT NOT NULL CHECK (kind IN ('access','purchase')),
  matched_on TEXT NOT NULL CHECK (matched_on IN ('chassis','engine')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','declined','withdrawn','expired')),
  -- Free text from the requester, shown to the holder. Capped by the schema and
  -- never rendered as markup.
  message TEXT,
  -- The identifier the requester typed, echoed back to them so they can tell two
  -- claims apart. Never anything they did not already know.
  identifier_hint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  -- The unresponsive-holder fallback: when a claim went unanswered and the
  -- requester started their own record instead, this is that record. There is
  -- deliberately NO automatic transfer — see routes/vehicleShares.ts.
  separate_record_bike_id TEXT REFERENCES bike(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One open claim per (vehicle, requester). Without this a requester could file
-- the same claim repeatedly and turn a holder's inbox into a channel for
-- harassment — and the rate limiter alone would not stop it, since a claim is a
-- durable row rather than a request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_open
  ON vehicle_claim(bike_id, requester_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_claim_bike ON vehicle_claim(bike_id, status);
CREATE INDEX IF NOT EXISTS idx_claim_requester ON vehicle_claim(requester_id, status);

-- The opaque capability handed out with a 409. It is a stored row rather than a
-- signed blob so it can be revoked, expires on its own, and — crucially — never
-- has to contain the bike id, which means the requester cannot learn one.
CREATE TABLE IF NOT EXISTS vehicle_claim_token (
  token TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  -- Bound to the user who hit the duplicate, so a leaked token is worthless to
  -- anybody else.
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  matched_on TEXT NOT NULL CHECK (matched_on IN ('chassis','engine')),
  identifier_hint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claim_token_user ON vehicle_claim_token(user_id, expires_at);

-- ─── 4. handover audit ───────────────────────────────────────────────────────
--
-- Every change of hands, permanently. A handover moves a real asset's record
-- between two people, so "who did this, when, and on whose approval" has to
-- survive both of them deleting their accounts — hence SET NULL rather than
-- CASCADE on the user references.
CREATE TABLE IF NOT EXISTS vehicle_handover (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  from_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  to_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  claim_id TEXT REFERENCES vehicle_claim(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('claim_approved','holder_initiated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_handover_bike ON vehicle_handover(bike_id, created_at);

-- ─── 5. backfill ─────────────────────────────────────────────────────────────
--
-- Existing vehicles must join the registry, or the live database's duplicate
-- detection would only ever see vehicles added after today.
--
-- The fold is reproduced here in SQL rather than deferred to a boot-time job,
-- because a job that has not run yet is a window in which the uniqueness rule is
-- silently off. Nested REPLACE covers the separators that occur in real data
-- (space, dash, dot, slash, underscore) and the four OCR confusions; it must
-- stay byte-compatible with `foldIdentity()` in lib/vehicleIdentity.ts, which is
-- what every write from now on goes through.
--
-- INSERT OR IGNORE with an explicit ORDER BY is what makes this safe on a
-- database that may already contain two records of the same car: the OLDEST
-- record wins the identity and the later one simply gets no registry row. It
-- keeps working (nothing is deleted or renamed), it just is not the holder of
-- record — and its owner can file a claim like anyone else. A plain INSERT would
-- have aborted the migration and taken the deploy with it.
INSERT OR IGNORE INTO vehicle_identity (bike_id, kind, match_key, value)
-- UPPER, to match what normalizeChassis()/normalizeEngineNo() store from now on.
SELECT b.id, 'chassis', folded.k, UPPER(TRIM(b.chassis_no))
  FROM bike b
  JOIN (SELECT id,
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                 UPPER(COALESCE(chassis_no,'')),
                 ' ',''),'-',''),'.',''),'/',''),'_',''),
                 'O','0'),'Q','0'),'I','1'),'S','5'),'B','8') AS k
          FROM bike) folded ON folded.id = b.id
 WHERE b.chassis_no IS NOT NULL
   -- A chassis identity is only claimed for something VIN-shaped. Seventeen
   -- characters is the whole test that matters: a partial or mistyped chassis
   -- must not lock a real VIN out of the registry.
   AND LENGTH(folded.k) = 17
 ORDER BY b.created_at ASC, b.id ASC;

INSERT OR IGNORE INTO vehicle_identity (bike_id, kind, match_key, value)
SELECT b.id, 'engine', folded.k, UPPER(TRIM(b.engine_no))
  FROM bike b
  JOIN (SELECT id,
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                 UPPER(COALESCE(engine_no,'')),
                 ' ',''),'-',''),'.',''),'/',''),'_',''),
                 'O','0'),'Q','0'),'I','1'),'S','5'),'B','8') AS k
          FROM bike) folded ON folded.id = b.id
 WHERE b.engine_no IS NOT NULL
   -- Short strings collide by accident, and an accidental collision here would
   -- block a real vehicle from being added. Six characters is the floor.
   AND LENGTH(folded.k) >= 6
 ORDER BY b.created_at ASC, b.id ASC;
