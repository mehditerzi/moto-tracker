-- Lightweight, self-hosted product telemetry. One row per client-tracked event
-- — no third-party analytics; user data stays on this box. user_id is scoped to
-- the authenticated user (cascade-deleted with the account). props is a small
-- JSON blob of event-specific fields; session_id groups a single app session;
-- client_ts is the event time as seen on the device (created_at is server time).
CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  props TEXT,
  session_id TEXT,
  client_ts TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_name_created ON event(name, created_at);
CREATE INDEX IF NOT EXISTS idx_event_user ON event(user_id);
