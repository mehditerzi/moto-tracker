-- Broaden the maintenance_item.kind CHECK to match the shared zod schema.
-- When the app was generalised from motorcycles to all vehicles, the allowed
-- kinds in packages/shared (maintenance.ts) grew to include 'battery' and
-- 'air_filter', but this table's CHECK constraint was never updated — so
-- inserting those kinds passed API validation yet failed at the DB with a 500.
-- SQLite can't ALTER a CHECK in place, so rebuild the table.

CREATE TABLE maintenance_item_new (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('engine_oil','brakes','tires','battery','coolant','air_filter','chain','custom')),
  custom_label TEXT,
  last_done_on TEXT,
  last_done_km INTEGER,
  interval_months INTEGER,
  interval_km INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO maintenance_item_new
  (id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km,
   interval_months, interval_km, notes, created_at, updated_at)
SELECT
  id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km,
  interval_months, interval_km, notes, created_at, updated_at
FROM maintenance_item;

DROP TABLE maintenance_item;
ALTER TABLE maintenance_item_new RENAME TO maintenance_item;
CREATE INDEX IF NOT EXISTS idx_maint_bike ON maintenance_item(bike_id, kind);
