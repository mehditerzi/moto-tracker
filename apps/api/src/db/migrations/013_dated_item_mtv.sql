-- Add 'mtv' (Motorlu Taşıtlar Vergisi — vehicle tax) as a 4th tracked deadline.
-- SQLite can't ALTER a CHECK constraint, so both constrained tables are rebuilt.

-- dated_item has an incoming FK (document.applied_dated_item_id ON DELETE SET
-- NULL). With foreign_keys=ON, DROP fires an implicit DELETE that would null
-- those provenance links, so we snapshot and restore them around the rebuild.
CREATE TEMP TABLE _doc_link AS
  SELECT id, applied_dated_item_id FROM document WHERE applied_dated_item_id IS NOT NULL;

CREATE TABLE dated_item_new (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sigorta','kasko','muayene','mtv')),
  expires_on TEXT NOT NULL,
  provider TEXT,
  policy_no TEXT,
  cost REAL,
  notes TEXT,
  source_document_id TEXT,
  ocr_confidence REAL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO dated_item_new SELECT * FROM dated_item;
DROP TABLE dated_item;
ALTER TABLE dated_item_new RENAME TO dated_item;
CREATE INDEX IF NOT EXISTS idx_dated_user_type_exp ON dated_item(user_id, type, expires_on);
CREATE INDEX IF NOT EXISTS idx_dated_bike_type ON dated_item(bike_id, type, expires_on DESC);

UPDATE document SET applied_dated_item_id =
  (SELECT applied_dated_item_id FROM _doc_link WHERE _doc_link.id = document.id)
  WHERE id IN (SELECT id FROM _doc_link);
DROP TABLE _doc_link;

-- notification_preference: no incoming FKs, so a plain rebuild is enough.
CREATE TABLE notification_preference_new (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('sigorta','kasko','muayene','maintenance','mtv')),
  lead_days_csv TEXT NOT NULL DEFAULT '30,7,1',
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, item_type)
);
INSERT INTO notification_preference_new SELECT * FROM notification_preference;
DROP TABLE notification_preference;
ALTER TABLE notification_preference_new RENAME TO notification_preference;
