-- Monetization: the first vehicle is free; additional vehicles require an active
-- auto-renewable App Store subscription. This table holds each user's CURRENT
-- resolved entitlement. The ABSENCE of a row means the free tier
-- (max_vehicles = 1) — we never need to seed it. Updated by StoreKit transaction
-- verification (client → /api/iap/verify) and by App Store Server
-- Notifications V2 (Apple → /api/iap/webhook).
CREATE TABLE IF NOT EXISTS entitlement (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  -- App Store product the user is currently entitled to (null = free tier).
  product_id TEXT,
  -- Internal tier key mirroring the shared IAP catalog ('garage3', …).
  tier TEXT NOT NULL DEFAULT 'free',
  -- Active-vehicle ceiling this entitlement grants. Free = 1.
  max_vehicles INTEGER NOT NULL DEFAULT 1,
  -- 'free' | 'active' | 'grace' | 'expired'. Resolution treats anything past
  -- expires_at as effectively free, but we keep the last known status for UX.
  status TEXT NOT NULL DEFAULT 'free',
  -- Apple's originalTransactionId ties every renewal of a subscription together;
  -- it's how a later server notification finds the owning user.
  original_transaction_id TEXT,
  -- ISO-8601 UTC end of the current paid period; null on the free tier.
  expires_at TEXT,
  -- 'Sandbox' | 'Production' so a sandbox purchase can't grant prod access.
  environment TEXT,
  -- Provenance of the entitlement grant ('appstore'); reserved for future use.
  source TEXT NOT NULL DEFAULT 'appstore',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entitlement_original_tx
  ON entitlement(original_transaction_id);

-- Append-only log of every verified App Store transaction we've applied, keyed
-- by Apple's transactionId. Gives us idempotency (a replayed webhook or a
-- re-verified receipt can't double-apply) and an audit trail to reconstruct
-- entitlement from history if ever needed.
CREATE TABLE IF NOT EXISTS iap_transaction (
  transaction_id TEXT PRIMARY KEY,
  -- Nullable: a server notification may arrive before we've mapped the user
  -- (e.g. reinstall). We still record it and reconcile via original_transaction_id.
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  original_transaction_id TEXT,
  product_id TEXT NOT NULL,
  purchase_date TEXT,
  expires_date TEXT,
  environment TEXT,
  -- 'verify' (client JWS) | 'notification' (Apple server-to-server).
  received_via TEXT NOT NULL,
  -- The verified, decoded transaction payload as JSON, for debugging/audit.
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_iap_tx_user ON iap_transaction(user_id);
CREATE INDEX IF NOT EXISTS idx_iap_tx_original ON iap_transaction(original_transaction_id);
