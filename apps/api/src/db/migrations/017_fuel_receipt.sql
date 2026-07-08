-- Fuel receipt scans: 'yakit' joins the recognized doc_types, a verified scan
-- auto-creates a fuel_log, and both sides keep provenance links.
-- SQLite can't ALTER a CHECK constraint, so document is rebuilt (nothing
-- references document by FK — source_document_id columns are plain TEXT —
-- so no snapshot dance like 013 needed).

CREATE TABLE document_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bike_id TEXT REFERENCES bike(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  doc_type TEXT CHECK (doc_type IN ('ruhsat','sigorta','kasko','muayene','yakit','unknown')),
  ocr_raw_json TEXT,
  ocr_extracted_json TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed')),
  ocr_model TEXT,
  ocr_error TEXT,
  applied_dated_item_id TEXT REFERENCES dated_item(id) ON DELETE SET NULL,
  applied_fuel_log_id TEXT REFERENCES fuel_log(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO document_new
  (id, user_id, bike_id, file_path, mime_type, size_bytes, doc_type, ocr_raw_json,
   ocr_extracted_json, ocr_status, ocr_model, ocr_error, applied_dated_item_id,
   created_at, updated_at)
  SELECT id, user_id, bike_id, file_path, mime_type, size_bytes, doc_type, ocr_raw_json,
         ocr_extracted_json, ocr_status, ocr_model, ocr_error, applied_dated_item_id,
         created_at, updated_at
  FROM document;
DROP TABLE document;
ALTER TABLE document_new RENAME TO document;
CREATE INDEX IF NOT EXISTS idx_doc_user ON document(user_id, ocr_status);
CREATE INDEX IF NOT EXISTS idx_doc_bike ON document(bike_id);

-- Provenance from the fuel side: which scan created this fill (plain TEXT,
-- consistent with dated_item.source_document_id).
ALTER TABLE fuel_log ADD COLUMN source_document_id TEXT;
