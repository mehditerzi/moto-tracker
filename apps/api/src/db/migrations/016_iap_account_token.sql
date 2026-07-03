-- Maps our app user to the UUID we pass to StoreKit as `appAccountToken` at
-- purchase time. Apple echoes that UUID back inside every signed transaction and
-- server notification for the subscription, so we can attribute a renewal /
-- cancellation to the right user even if a notification arrives BEFORE the
-- client ever calls /api/iap/verify (e.g. a reinstall, or a purchase that the
-- app didn't finish reporting). The token is an opaque UUID — no PII.
CREATE TABLE IF NOT EXISTS iap_account_token (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_iap_account_token_token ON iap_account_token(token);
