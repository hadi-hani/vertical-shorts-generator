'use strict';

const { getDb } = require('../index');

function upsertSubscription({ id, userId, plan = 'premium', status, paypalEmail }) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO subscriptions (id, user_id, plan, status, paypal_email, created_at, updated_at)
       VALUES (@id, @userId, @plan, @status, @paypalEmail, @now, @now)
       ON CONFLICT(user_id) DO UPDATE SET
         id = excluded.id,
         plan = excluded.plan,
         status = excluded.status,
         paypal_email = excluded.paypal_email,
         updated_at = excluded.updated_at`
    )
    .run({ id, userId, plan, status, paypalEmail: paypalEmail || null, now });
}

function getByUser(userId) {
  return getDb().prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId) || null;
}

function getBySubscriptionId(id) {
  return getDb().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) || null;
}

function setUserPlan(userId, plan) {
  getDb()
    .prepare('UPDATE users SET plan = ?, updated_at = ? WHERE id = ?')
    .run(plan, new Date().toISOString(), userId);
}

function recordWebhookEvent(eventId, eventType, payload) {
  const existing = getDb()
    .prepare('SELECT 1 FROM webhook_events WHERE event_id = ?')
    .get(eventId);
  if (existing) return false;
  getDb()
    .prepare('INSERT INTO webhook_events (event_id, event_type, payload, received_at) VALUES (?, ?, ?, ?)')
    .run(eventId, eventType, JSON.stringify(payload), new Date().toISOString());
  return true;
}

function premiumCount() {
  return getDb()
    .prepare("SELECT COUNT(*) AS c FROM users WHERE plan = 'premium'")
    .get().c;
}

module.exports = { upsertSubscription, getByUser, getBySubscriptionId, setUserPlan, recordWebhookEvent, premiumCount };