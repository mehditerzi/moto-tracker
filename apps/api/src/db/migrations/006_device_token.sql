-- Native push device tokens (APNs for the iOS Capacitor app). Separate from
-- push_subscription, which holds Web Push (VAPID) endpoints for browsers.
CREATE TABLE IF NOT EXISTS device_token (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_device_token_user ON device_token(user_id);
