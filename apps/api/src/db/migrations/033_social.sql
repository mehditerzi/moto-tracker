-- The social layer: rider profiles, follows, a feed of shared rides, kudos
-- ("Gaz!") and comments — plus the safety tools App Review 1.2 requires for
-- user-generated content: community-rules acceptance, reports and blocks.
--
-- Nothing becomes social by itself. A trip is private until its owner posts
-- it, and a post stores a SNAPSHOT (distance, time, vehicle, a route with the
-- first and last stretch trimmed off) so deleting or editing the trip later
-- cannot leak anything new, and the route never reveals where someone lives.

CREATE TABLE IF NOT EXISTS rider_profile (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  bio TEXT,
  city TEXT,
  show_garage INTEGER NOT NULL DEFAULT 1,
  rules_accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS follow (
  follower_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_followee ON follow(followee_id);

CREATE TABLE IF NOT EXISTS user_block (
  blocker_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_block_blocked ON user_block(blocked_id);

CREATE TABLE IF NOT EXISTS post (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  trip_id TEXT REFERENCES trip(id) ON DELETE SET NULL,
  caption TEXT,
  distance_km REAL NOT NULL,
  duration_min INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  route TEXT,
  vehicle_type TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  vehicle_name TEXT,
  hidden_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_post_user ON post(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_created ON post(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_trip ON post(trip_id) WHERE trip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS post_kudos (
  post_id TEXT NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comment (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  hidden_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_post_comment_post ON post_comment(post_id, created_at);

CREATE TABLE IF NOT EXISTS content_report (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('post', 'comment', 'user')),
  target_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reporter_id, target_kind, target_id)
);
