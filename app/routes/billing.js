'use strict';

const express = require('express');

const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const paypal = require('../services/paypal');
const billingRepo = require('../db/repositories/billing');
const usersRepo = require('../db/repositories/users');
const { log } = require('../lib/logger');

const router = express.Router();

function baseUrl() {
  return config.PAYPAL_BASE_URL || `http://localhost:${config.PORT}`;
}

/* Resolve the owning user from a webhook resource: prefer custom_id, then
 * look up the subscription id we stored. */
function resolveUserId(resource) {
  if (!resource) return null;
  if (resource.custom_id) return resource.custom_id;
  const subId = resource.id || resource.billing_agreement_id || resource.subscription_id;
  if (subId) {
    const sub = billingRepo.getBySubscriptionId(subId);
    if (sub) return sub.user_id;
  }
  return null;
}

const ACTIVATE_EVENTS = [
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.APPROVED',
  'PAYMENT.SALE.COMPLETED',
];
const DEACTIVATE_EVENTS = [
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'PAYMENT.SALE.REFUNDED',
  'PAYMENT.SALE.REVERSED',
];

router.post('/checkout', requireAuth, async (req, res) => {
  const user = usersRepo.findById(req.user.id);
  if (!user) {
    return res.status(401).json({ error: 'unauthorized', message: 'يجب تسجيل الدخول أولاً' });
  }
  if (user.plan === 'premium') {
    return res.status(409).json({ error: 'already_premium', message: 'اشتراكك مفعّل بالفعل' });
  }
  if (!paypal.isConfigured()) {
    return res
      .status(503)
      .json({ error: 'paypal_not_configured', message: 'الدفع غير متاح حالياً، حاول لاحقاً' });
  }
  try {
    const sub = await paypal.createSubscription({
      userId: user.id,
      email: user.email,
      returnUrl: `${baseUrl()}/api/billing/success`,
      cancelUrl: `${baseUrl()}/api/billing/cancel`,
    });
    log('info', 'billing_checkout', { userId: user.id, paypalSubscriptionId: sub.id });
    res.json({ subscriptionId: sub.id, approvalUrl: sub.approveUrl });
  } catch (err) {
    log('error', 'billing_checkout_failed', { userId: user.id, message: err.message });
    res
      .status(502)
      .json({ error: 'checkout_failed', message: 'تعذر إنشاء جلسة الدفع، حاول لاحقاً' });
  }
});

router.post('/cancel', requireAuth, async (req, res) => {
  const user = usersRepo.findById(req.user.id);
  if (!user || user.plan !== 'premium') {
    return res
      .status(400)
      .json({ error: 'no_active_subscription', message: 'لا يوجد اشتراك مفعّل' });
  }
  const sub = billingRepo.getByUser(user.id);
  try {
    if (sub && paypal.isConfigured()) await paypal.cancelSubscription(sub.id);
  } catch (err) {
    log('error', 'billing_cancel_failed', { userId: user.id, message: err.message });
    return res
      .status(502)
      .json({ error: 'cancel_failed', message: 'تعذر إلغاء الاشتراك، حاول لاحقاً' });
  }
  billingRepo.setUserPlan(user.id, 'free');
  log('info', 'billing_cancelled', {
    userId: user.id,
    paypalSubscriptionId: sub ? sub.id : null,
  });
  res.json({ plan: 'free' });
});

/* PayPal webhook — the source of truth for subscription state. Signature is
 * verified against PayPal before any state change. */
router.post('/webhook', async (req, res) => {
  let verified = false;
  try {
    verified = await paypal.verifyWebhook(req.headers, req.body);
  } catch (_) {
    verified = false;
  }
  if (!verified) {
    return res.status(400).json({ error: 'invalid_signature' });
  }

  const event = req.body || {};
  const eventId = event.id;
  if (!eventId) {
    return res.status(400).json({ error: 'missing_event_id' });
  }
  if (!billingRepo.recordWebhookEvent(eventId, event.event_type || '', event)) {
    return res.json({ ok: true, duplicate: true });
  }

  const type = event.event_type || '';
  const resource = event.resource || {};
  const userId = resolveUserId(resource);
  const subId = resource.id || resource.billing_agreement_id || resource.subscription_id;

  if (ACTIVATE_EVENTS.includes(type)) {
    if (userId) {
      billingRepo.setUserPlan(userId, 'premium');
      if (subId) {
        billingRepo.upsertSubscription({
          id: subId,
          userId,
          status: 'ACTIVE',
          paypalEmail: resource.subscriber && resource.subscriber.email_address,
        });
      }
    }
  } else if (DEACTIVATE_EVENTS.includes(type)) {
    if (userId) billingRepo.setUserPlan(userId, 'free');
    if (userId && subId) {
      billingRepo.upsertSubscription({ id: subId, userId, status: 'INACTIVE' });
    }
  }

  log('info', 'billing_webhook', {
    eventType: type,
    userId: userId || null,
    paypalSubscriptionId: subId || null,
  });
  res.json({ ok: true });
});

/* Simple Arabic pages shown after PayPal redirects the buyer back. */
router.get('/success', (req, res) => {
  res.send(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>شكراً</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding-top:3rem">' +
      '<h2>تم تفعيل اشتراكك!</h2><p>قد يستغرق التفعيل دقيقة أو دقيقتين.</p>' +
      '<p><a href="/projects">الذهاب إلى مشاريعي</a></p></body></html>'
  );
});

router.get('/cancel', (req, res) => {
  res.send(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تم الإلغاء</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding-top:3rem">' +
      '<h2>تم إلغاء الدفع</h2><p>لم يحدث أي تغيير على اشتراكك.</p>' +
      '<p><a href="/projects">العودة إلى المشاريع</a></p></body></html>'
  );
});

module.exports = router;