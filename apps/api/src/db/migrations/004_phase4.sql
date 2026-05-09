CREATE TABLE IF NOT EXISTS maintenance_item (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('engine_oil','chain','brakes','tires','coolant','custom')),
  custom_label TEXT,
  last_done_on TEXT,
  last_done_km INTEGER,
  interval_months INTEGER,
  interval_km INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maint_bike ON maintenance_item(bike_id, kind);

CREATE TABLE IF NOT EXISTS notification_preference (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('sigorta','kasko','muayene','maintenance')),
  lead_days_csv TEXT NOT NULL DEFAULT '30,7,1',
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, item_type)
);

CREATE TABLE IF NOT EXISTS push_subscription (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscription(user_id);

CREATE TABLE IF NOT EXISTS notification_sent (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('dated','maintenance')),
  item_id TEXT NOT NULL,
  lead_days INTEGER NOT NULL,
  sent_on TEXT NOT NULL,
  UNIQUE (item_kind, item_id, lead_days, sent_on)
);
CREATE INDEX IF NOT EXISTS idx_sent_user ON notification_sent(user_id, sent_on);
