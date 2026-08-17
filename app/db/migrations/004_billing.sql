-- Billing: user plan + PayPal subscriptions + webhook dedup log.
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';

CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,          -- PayPal subscription id
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL DEFAULT 'premium',
  status        TEXT NOT NULL,             -- ACTIVE | INACTIVE | ...
  paypal_email  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  received_at TEXT NOT NULL
);