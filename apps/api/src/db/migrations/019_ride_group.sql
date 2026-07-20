-- Live group rides ("birlikte sür"): a group is a short-lived room friends
-- join by code to see each other on the map. Only membership is persisted —
-- live POSITIONS are never written to disk (in-memory fan-out only), so a
-- ride leaves no location trail beyond the members' own trip recordings.
CREATE TABLE IF NOT EXISTS ride_group (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS ride_member (
  group_id TEXT NOT NULL REFERENCES ride_group(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  left_at TEXT,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ride_member_user ON ride_member(user_id);
