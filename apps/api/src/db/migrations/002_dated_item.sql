CREATE TABLE IF NOT EXISTS dated_item (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sigorta','kasko','muayene')),
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
CREATE INDEX IF NOT EXISTS idx_dated_user_type_exp ON dated_item(user_id, type, expires_on);
CREATE INDEX IF NOT EXISTS idx_dated_bike_type ON dated_item(bike_id, type, expires_on DESC);
