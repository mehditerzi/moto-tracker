-- ===== The vehicle assistant: expenses, mechanics, glovebox, SOS contacts =====
--
-- Four things owners kept asking for that the app had no place for:
--
--   expense          what a vehicle costs beyond fuel — parking, tolls, washes,
--                    repairs, fines, MTV. Fuel stays in fuel_log (it has litres
--                    and an odometer); dated items and maintenance keep their own
--                    `cost`. The cost report is the UNION of the four.
--   mechanic         the people you trust with the car, one tap away.
--   attachment       the digital glovebox: any photo or PDF filed against a
--                    vehicle (licence, invoice, service slip). Scanned documents
--                    stay in `document` — that table is an OCR pipeline, not a
--                    filing cabinet, and its CHECK constraints say so.
--   sos_contact      who to tell when something goes wrong on the road.
--
-- Every row is the CALLER's (`user_id`), exactly like fuel_log: what somebody
-- spent is not a fact about the car, so a vehicle shared with you does not
-- show you the owner's parking receipts.

CREATE TABLE expense (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'repair','parts','tires','wash','parking','toll','fine','tax','insurance','accessory','other'
  )),
  amount REAL NOT NULL CHECK (amount >= 0),
  spent_on TEXT NOT NULL,
  odometer_km INTEGER,
  vendor TEXT,
  notes TEXT,
  attachment_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expense_bike_date ON expense(bike_id, spent_on);
CREATE INDEX idx_expense_user ON expense(user_id);

CREATE TABLE mechanic (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT 'general' CHECK (specialty IN (
    'general','electric','tires','body','paint','glass','tow','motorcycle','dealer','other'
  )),
  phone TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  notes TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mechanic_user ON mechanic(user_id, favorite DESC, name);

CREATE TABLE attachment (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bike_id TEXT REFERENCES bike(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN (
    'registration','license','insurance','kasko','inspection','invoice','service','warranty','other'
  )),
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  expires_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachment_user_bike ON attachment(user_id, bike_id, created_at);

CREATE TABLE sos_contact (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sos_contact_user ON sos_contact(user_id);
