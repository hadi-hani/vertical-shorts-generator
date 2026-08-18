'use strict';

/* Pure-unit tests for the PayPal webhook decision module. No HTTP, no DB,
 * no server spawn — runs in milliseconds. Run via: node --test test/webhook.test.js */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decide } = require('../app/services/subscription-events');

function mkSub(id, status) {
  return { id, user_id: 'u1', plan: 'premium', status, paypal_email: 'a@b.c' };
}
function run(eventType, subId, currentSub) {
  return decide({ eventType, subId, currentSub });
}

describe('decide — unknown events', () => {
  it('ignores a completely unknown event type', () => {
    const r = run('SOME.UNKNOWN', 'sub-1', null);
    assert.equal(r.action, 'ignore');
  });
  it('ignores missing event type', () => {
    const r = decide({ eventType: '', subId: 's', currentSub: null });
    assert.equal(r.action, 'ignore');
  });
  it('ignores missing sub id', () => {
    const r = decide({ eventType: 'BILLING.SUBSCRIPTION.ACTIVATED', subId: null, currentSub: null });
    assert.equal(r.action, 'ignore');
  });
});

describe('decide — activate', () => {
  it('activates when there is no existing subscription', () => {
    const r = run('BILLING.SUBSCRIPTION.ACTIVATED', 'sub-a', null);
    assert.equal(r.action, 'activate');
    assert.equal(r.plan, 'premium');
  });
  it('activates an APPROVED event (pre-activation)', () => {
    const r = run('BILLING.SUBSCRIPTION.APPROVED', 'sub-a', null);
    assert.equal(r.action, 'activate');
  });
  it('activates a NEW sub id after the old one was cancelled (re-subscription)', () => {
    const r = run('BILLING.SUBSCRIPTION.ACTIVATED', 'sub-b', mkSub('sub-a', 'INACTIVE'));
    assert.equal(r.action, 'activate');
  });
  it('ignores a stale activate for the SAME cancelled sub (delayed webhook protection)', () => {
    const r = run('BILLING.SUBSCRIPTION.ACTIVATED', 'sub-a', mkSub('sub-a', 'INACTIVE'));
    assert.equal(r.action, 'ignore');
    assert.ok(r.reason && r.reason.includes('sub_inactivated'));
  });
  it('ignores a duplicate activate (already ACTIVE, same sub)', () => {
    const r = run('BILLING.SUBSCRIPTION.ACTIVATED', 'sub-a', mkSub('sub-a', 'ACTIVE'));
    assert.equal(r.action, 'ignore');
    assert.ok(r.reason && r.reason.includes('already_active'));
  });
  it('ignores a stale activate for a DIFFERENT sub while user has an ACTIVE sub', () => {
    const r = run('BILLING.SUBSCRIPTION.ACTIVATED', 'sub-old', mkSub('sub-new', 'ACTIVE'));
    assert.equal(r.action, 'ignore');
    assert.ok(r.reason && r.reason.includes('sub_id_mismatch'));
  });
});

describe('decide — deactivate', () => {
  it('deactivates when the sub is ACTIVE and matches', () => {
    const r = run('BILLING.SUBSCRIPTION.CANCELLED', 'sub-a', mkSub('sub-a', 'ACTIVE'));
    assert.equal(r.action, 'deactivate');
    assert.equal(r.plan, 'free');
  });
  it('deactivates on refund/reversed', () => {
    assert.equal(run('PAYMENT.SALE.REFUNDED', 'sub-a', mkSub('sub-a', 'ACTIVE')).action, 'deactivate');
    assert.equal(run('PAYMENT.SALE.REVERSED', 'sub-a', mkSub('sub-a', 'ACTIVE')).action, 'deactivate');
  });
  it('deactivates on PAYMENT.SALE.DENIED', () => {
    const r = run('PAYMENT.SALE.DENIED', 'sub-a', mkSub('sub-a', 'ACTIVE'));
    assert.equal(r.action, 'deactivate');
  });
  it('deactivates on BILLING.SUBSCRIPTION.PAYMENT.FAILED', () => {
    const r = run('BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'sub-a', mkSub('sub-a', 'ACTIVE'));
    assert.equal(r.action, 'deactivate');
  });
  it('ignores a duplicate deactivate (already INACTIVE, same sub)', () => {
    const r = run('BILLING.SUBSCRIPTION.CANCELLED', 'sub-a', mkSub('sub-a', 'INACTIVE'));
    assert.equal(r.action, 'ignore');
    assert.ok(r.reason && r.reason.includes('already_inactive'));
  });
  it('ignores a stale deactivate for a DIFFERENT sub', () => {
    const r = run('BILLING.SUBSCRIPTION.CANCELLED', 'sub-old', mkSub('sub-new', 'ACTIVE'));
    assert.equal(r.action, 'ignore');
    assert.ok(r.reason && r.reason.includes('sub_id_mismatch'));
  });
});