-- Monthly usage counters per user (free-plan quota).
CREATE TABLE IF NOT EXISTS usage_monthly (
  user_id           TEXT NOT NULL,
  period            TEXT NOT NULL,  -- 'YYYY-MM'
  videos_generated  INTEGER NOT NULL DEFAULT 0,
  seconds_generated INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (user_id, period)
);
