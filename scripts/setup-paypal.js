'use strict';

/* One-time PayPal setup helper: creates the subscription product, a monthly
 * billing plan (price from PAYPAL_PRICE, default 9.99 USD) and a webhook that
 * points at WEBHOOK_URL, then prints the values to paste into .env.
 *
 * Usage (after setting PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_MODE):
 *   WEBHOOK_URL=https://your-url/api/billing/webhook node scripts/setup-paypal.js
 */

const paypal = require('../app/services/paypal');
const config = require('../app/config');

const PRICE = String(config.PAYPAL_PRICE || '9.99');
const CURRENCY = 'USD';
const PRODUCT_NAME = 'Shorts Generator';
const PLAN_NAME = 'Shorts Generator Premium (Monthly)';
const PLAN_DESC = 'Monthly premium plan: larger video quota.';

/* All events the app handles (see app/services/subscription-events.js). */
const WEBHOOK_EVENTS = [
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.APPROVED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED',
  'PAYMENT.SALE.DENIED',
  'PAYMENT.SALE.REFUNDED',
  'PAYMENT.SALE.REVERSED',
];

async function findOrCreateProduct() {
  const list = await paypal.api('/v1/catalogs/products?page_size=50');
  const existing = (list.products || []).find((p) => p.name === PRODUCT_NAME);
  if (existing) return existing.id;
  const created = await paypal.api('/v1/catalogs/products', {
    method: 'POST',
    body: JSON.stringify({
      name: PRODUCT_NAME,
      description: 'Vertical shorts generation service',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });
  return created.id;
}

async function createPlan(productId) {
  const plans = await paypal.api('/v1/billing/plans?page_size=20');
  const existing = (plans.plans || []).find(
    (p) => p.name === PLAN_NAME && p.product_id === productId
  );
  let plan = existing;
  if (!plan) {
    plan = await paypal.api('/v1/billing/plans', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        name: PLAN_NAME,
        description: PLAN_DESC,
        billing_cycles: [
          {
            frequency: { interval_unit: 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: { value: PRICE, currency_code: CURRENCY },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee: { value: '0', currency_code: CURRENCY },
          payment_failure_threshold: 2,
        },
      }),
    });
  }
  if (plan.status !== 'ACTIVE') {
    await paypal.api(`/v1/billing/plans/${plan.id}/activate`, { method: 'POST', body: '{}' });
  }
  return plan.id;
}

async function createWebhook(url) {
  const hooks = await paypal.api('/v1/notifications/webhooks');
  const existing = (hooks.webhooks || []).find((w) => w.url === url);
  if (existing) return existing.id;
  const created = await paypal.api('/v1/notifications/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      url,
      event_types: WEBHOOK_EVENTS.map((name) => ({ name })),
    }),
  });
  return created.id;
}

async function main() {
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET) {
    console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET first.');
    process.exitCode = 1;
    return;
  }
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('Pass WEBHOOK_URL=https://your-host/api/billing/webhook');
    process.exitCode = 1;
    return;
  }
  const productId = await findOrCreateProduct();
  console.log(`product_id: ${productId}`);
  const planId = await createPlan(productId);
  console.log(`PAYPAL_PLAN_ID=${planId}`);
  const webhookId = await createWebhook(webhookUrl);
  console.log(`PAYPAL_WEBHOOK_ID=${webhookId}`);
  console.log(`WEBHOOK_URL=${webhookUrl}`);
}

main().catch((err) => {
  console.error('setup failed:', err.message);
  process.exitCode = 1;
});