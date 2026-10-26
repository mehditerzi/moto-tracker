-- Planned group rides: a dated meet-up that friends join through an invite
-- link (/r/<code>). Unlike ride_group (the live map room, positions in memory
-- only), these are persisted plans: when, where to meet, where to, who comes.
-- On the day the organiser opens a live ride from it (live_group_id).
CREATE TABLE IF NOT EXISTS ride_event (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  note TEXT,
  starts_at TEXT NOT NULL,            -- ISO-8601 UTC
  meet_name TEXT NOT NULL,
  meet_lat REAL,
  meet_lng REAL,
  dest_name TEXT,
  dest_lat REAL,
  dest_lng REAL,
  distance_km REAL,
  pace TEXT NOT NULL DEFAULT 'relaxed',
  vehicle_kind TEXT NOT NULL DEFAULT 'any',
  max_riders INTEGER,
  live_group_id TEXT REFERENCES ride_group(id) ON DELETE SET NULL,
  reminded_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ride_event_owner ON ride_event(owner_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_ride_event_starts ON ride_event(starts_at);

CREATE TABLE IF NOT EXISTS ride_event_rsvp (
  event_id TEXT NOT NULL REFERENCES ride_event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('going', 'maybe')),
  bike_id TEXT REFERENCES bike(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ride_event_rsvp_user ON ride_event_rsvp(user_id);

-- Abuse reports on a ride someone was invited to (App Review 1.2: content made
-- by other users must be reportable). Reviewed by hand from the support inbox.
CREATE TABLE IF NOT EXISTS ride_event_report (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES ride_event(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, reporter_id)
);
