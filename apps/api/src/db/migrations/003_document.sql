CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bike_id TEXT REFERENCES bike(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  doc_type TEXT CHECK (doc_type IN ('ruhsat','sigorta','kasko','muayene','unknown')),
  ocr_raw_json TEXT,
  ocr_extracted_json TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed')),
  ocr_model TEXT,
  ocr_error TEXT,
  applied_dated_item_id TEXT REFERENCES dated_item(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_doc_user ON document(user_id, ocr_status);
CREATE INDEX IF NOT EXISTS idx_doc_bike ON document(bike_id);
