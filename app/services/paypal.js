'use strict';

/* PayPal REST API client (global fetch, no extra deps).
 * Modes: sandbox | live | mock. "mock" skips the network so the full flow can
 * be exercised in tests and local development without a PayPal account. */

const crypto = require('crypto');
const config = require('../config');

function apiBase() {
  if (config.PAYPAL_MODE === 'live') return 'https://api-m.paypal.com';
  return 'https://api-m.sandbox.paypal.com';
}

function isConfigured() {
  if (config.PAYPAL_MODE === 'mock') return Boolean(config.PAYPAL_PLAN_ID);
  return Boolean(
    config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET && config.PAYPAL_PLAN_ID
  );
}

let tokenCache = { value: null, expiresAt: 0 };

async function getAccessToken() {
  if (config.PAYPAL_MODE === 'mock') return 'mock-token';
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString(
          'base64'
        ),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`PayPal auth failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in - 60)) * 1000,
  };
  return data.access_token;
}

async function api(path, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (body && body.details && body.details[0] && body.details[0].description) ||
      (body && body.message) ||
      `HTTP ${res.status}`;
    throw new Error(`PayPal ${path}: ${detail}`);
  }
  return body;
}

async function createSubscription({ userId, email, returnUrl, cancelUrl }) {
  if (config.PAYPAL_MODE === 'mock') {
    return {
      id: `MOCK-SUB-${crypto.randomBytes(6).toString('hex')}`,
      status: 'APPROVAL_PENDING',
      approveUrl: returnUrl,
    };
  }
  const body = await api('/v1/billing/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: config.PAYPAL_PLAN_ID,
      custom_id: userId,
      subscriber: {
        name: { given_name: 'User', surname: '' },
        email_address: email,
      },
      application_context: {
        brand_name: 'Shorts Generator',
        locale: 'ar',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });
  const approve = (body.links || []).find((l) => l.rel === 'approve');
  return {
    id: body.id,
    status: body.status,
    approveUrl: approve ? approve.href : null,
  };
}

async function cancelSubscription(subId) {
  if (config.PAYPAL_MODE === 'mock') return;
  await api(`/v1/billing/subscriptions/${subId}/cancel`, {
    method: 'POST',
    body: '{}',
  });
}

async function verifyWebhook(headers, body) {
  if (config.PAYPAL_MODE === 'mock') return true;
  const verify = await api('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: config.PAYPAL_WEBHOOK_ID,
      webhook_event: body,
    }),
  });
  return verify.verification_status === 'SUCCESS';
}

module.exports = { apiBase, isConfigured, createSubscription, cancelSubscription, verifyWebhook };