-- ===== Event-driven notifications: sharing activity =====
--
-- Until now this app sent exactly one kind of notification: a daily reminder
-- that a document is about to expire, computed by a cron job from the state of
-- the database (notify/computeDueNotifications.ts). Nothing was ever sent
-- BECAUSE SOMETHING HAPPENED.
--
-- The sharing layer (027) needs the other kind. An access request, an ownership
-- claim and a garage invitation are all events in which one person is waiting
-- on another, and the design of the handover flow depends on the waiting party
-- actually being told: a claim expires unanswered after 21 days
-- (CLAIM_RESPONSE_DAYS), and a 21-day window that the holder was never informed
-- about is not a window, it is a countdown running in a room with nobody in it.
--
-- Two tables, for the two things a cron job gets for free and an event handler
-- does not: a place to record that a send already happened, and a preference
-- that is NOT the reminder preference.

-- ─── 1. idempotency for one-shot sends ───────────────────────────────────────
--
-- `notification_sent` cannot serve this. Its unit is
-- (user, item, lead_days, sent_on) — a reminder is expected to recur, once per
-- day per lead time, so the calendar day is part of its identity. An event is
-- the opposite: "somebody claimed your vehicle" is true exactly once, forever,
-- and a second delivery of it is always a bug. Reusing the daily table would
-- have meant either bolting a synthetic date onto an event that has none, or
-- rebuilding a live table's CHECK constraint to admit new item kinds. This
-- table has its own key and no date in it.
--
-- WHY `recipient` IS TEXT AND NOT A USER REFERENCE. The whole point of the
-- email path is the invitee who has NO ACCOUNT YET — there is no user row to
-- point at, and the only stable identity we have for them is the address the
-- inviter typed. So `recipient` holds the user id for a push and the lowercased
-- email address for a mail, and `user_id` is a nullable FK carried alongside it
-- purely so that deleting an account also deletes its notification history.
CREATE TABLE IF NOT EXISTS notification_event (
  id TEXT PRIMARY KEY,
  -- user id (push) or lowercased email address (mail to a non-user).
  recipient TEXT NOT NULL,
  -- Set only when the recipient has an account, so ON DELETE CASCADE can clean
  -- up. A mail to a stranger deliberately has no user to hang off.
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  -- Who caused this to be sent. Nullable because the actor may delete their
  -- account; kept because it is what the invitation-email abuse cap counts.
  actor_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'claim_access',     -- somebody asked for access to a vehicle you hold
    'claim_purchase',   -- somebody says they bought a vehicle you hold
    'claim_approved',   -- your request was granted
    'claim_declined',   -- your request was refused
    'share_invite'      -- you were invited into a garage
  )),
  -- What the event is ABOUT, and therefore what makes a repeat a duplicate. The
  -- claim id for the four claim kinds — a claim can only be created once and
  -- decided once, so the id alone is exactly-once. The GROUP id for an
  -- invitation, because an invitation is re-issuable by design (the inviter may
  -- legitimately press "send again" after a link expires) and the thing we want
  -- to bound is "how often may this address be mailed about this garage",
  -- which the cooldown in notify/events.ts enforces against `sent_at`.
  subject_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push','email')),
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- THE IDEMPOTENCY KEY. A retry, a double-tapped button or a replayed request
  -- collides here instead of reaching the recipient a second time. Channel is
  -- part of it so that a push and an email about the same invitation are two
  -- distinct deliveries rather than one suppressing the other.
  UNIQUE (recipient, kind, subject_id, channel)
);

-- The invitation-email abuse cap is "how many has THIS user sent recently", so
-- it reads by actor and time.
CREATE INDEX IF NOT EXISTS idx_notification_event_actor
  ON notification_event(actor_id, channel, sent_at);
-- Retention prunes by age (notify/retention.ts).
CREATE INDEX IF NOT EXISTS idx_notification_event_sent_at
  ON notification_event(sent_at);

-- ─── 2. a preference that is not the reminder preference ─────────────────────
--
-- `notification_preference` is keyed by `item_type` — sigorta, kasko, muayene,
-- maintenance, mtv — and means "how far ahead of an expiry do you want to be
-- warned". Sharing activity is not an expiry, has no lead time, and above all
-- is not the same DECISION: somebody who muted insurance reminders because
-- their insurer already texts them has said nothing whatsoever about whether
-- they want to know that a stranger is claiming to have bought their car.
-- Folding the two together would have made the quietest reasonable setting in
-- the app silently disable a security-relevant message.
--
-- So it is a separate table with a separate vocabulary and no lead days. It is
-- also NOT consulted for `claim_access` / `claim_purchase` — see the guard in
-- notify/events.ts and the note in routes/notificationPreferences.ts. A request
-- about a vehicle YOU hold starts a clock against you, and a preference toggle
-- must not be able to make it undeliverable.
CREATE TABLE IF NOT EXISTS notification_category_preference (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('sharing')),
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, category)
);
