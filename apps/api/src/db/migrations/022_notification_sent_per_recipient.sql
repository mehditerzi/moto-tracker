-- ===== One reminder, several recipients =====
--
-- Until organizations existed, a reminder had exactly one addressee: the person
-- who typed the record. `notification_sent` therefore deduped on
-- (item_kind, item_id, lead_days, sent_on) — the item alone — and that was
-- correct, because the item alone implied the recipient.
--
-- With a fleet it no longer does. A muayene expiring on a company van must
-- reach the owner, the managers, the staff who keep the paperwork, and the
-- driver currently holding it (notify/computeDueNotifications.ts). Under the
-- old key the FIRST of those recipients to be delivered would claim the row and
-- every other recipient would be suppressed for the day — silently, and
-- permanently for that lead time. The fleet's headline promise ("nobody misses
-- an expiry") would be met for exactly one person.
--
-- So the key gains `user_id`: the unit of idempotency is now "this reminder, to
-- this person, today". A re-run of the batch (or the boot catch-up) is still
-- exactly-once per recipient.
--
-- SQLite cannot drop a table-level UNIQUE constraint, so the table is rebuilt.
-- It has NO incoming foreign keys, which makes this a plain copy — and the new
-- key is strictly WEAKER than the old one (the old tuple being unique implies
-- the new, longer tuple is too), so every existing production row transfers
-- without a possible conflict and no history is lost.
CREATE TABLE notification_sent_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('dated','maintenance')),
  item_id TEXT NOT NULL,
  lead_days INTEGER NOT NULL,
  sent_on TEXT NOT NULL,
  UNIQUE (user_id, item_kind, item_id, lead_days, sent_on)
);

INSERT INTO notification_sent_new (id, user_id, item_kind, item_id, lead_days, sent_on)
  SELECT id, user_id, item_kind, item_id, lead_days, sent_on FROM notification_sent;

DROP TABLE notification_sent;
ALTER TABLE notification_sent_new RENAME TO notification_sent;

CREATE INDEX IF NOT EXISTS idx_sent_user ON notification_sent(user_id, sent_on);
-- The daily batch reads the whole day at once ("what has already gone out
-- today?"), which the user-leading index above cannot serve.
CREATE INDEX IF NOT EXISTS idx_sent_day ON notification_sent(sent_on);
