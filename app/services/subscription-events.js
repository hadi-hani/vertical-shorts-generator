'use strict';

/* Pure decision layer for PayPal subscription webhooks. Separated so it can
 * be unit-tested without plumbing the HTTP stack or the database.
 *
 * Rules:
 *   - Deduplication of identical events is handled upstream (webhook_events
 *     table) so this module only sees each eventId once.
 *   - ACTIVATE:
 *       * same sub already ACTIVE                -> ignore (duplicate)
 *       * same sub already INACTIVE              -> ignore (stale retry; the
 *         sub was cancelled/expired/suspended)
 *       * a DIFFERENT sub while user has an ACTIVE sub -> ignore (don't let a
 *         stale/parallel event clobber the current subscription)
 *       * otherwise (no sub, or different sub while inactive) -> activate
 *         (fresh approval flow / re-subscription with a new sub id)
 *   - DEACTIVATE:
 *       * different sub than the one stored      -> ignore (stale cancel)
 *       * same sub already INACTIVE              -> ignore (duplicate)
 *       * otherwise                              -> deactivate
 *   - Payment failure / denial events downgrade the plan. */

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
  'PAYMENT.SALE.DENIED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
];

/** Decide what to do given an incoming webhook event and the current
 * subscription row for the resolved user. Returns an object with:
 *   - action: 'activate' | 'deactivate' | 'ignore'
 *   - plan: optional, 'premium' | 'free'
 *   - reason: string describing why (for logging/tests) */
function decide({ eventType, subId, currentSub }) {
  if (!eventType || !subId) return { action: 'ignore', reason: 'missing_event_or_sub_id' };

  const isActivate = ACTIVATE_EVENTS.includes(eventType);
  const isDeactivate = DEACTIVATE_EVENTS.includes(eventType);
  if (!isActivate && !isDeactivate) return { action: 'ignore', reason: 'unknown_event_type' };

  if (currentSub) {
    const sameSub = String(currentSub.id) === String(subId);
    if (isActivate) {
      if (sameSub && currentSub.status === 'ACTIVE') {
        return { action: 'ignore', reason: 'already_active', note: 'duplicate activate event' };
      }
      if (sameSub && currentSub.status === 'INACTIVE') {
        return { action: 'ignore', reason: 'sub_inactivated', note: `stale activate for ${currentSub.status} sub` };
      }
      if (!sameSub && currentSub.status === 'ACTIVE') {
        return { action: 'ignore', reason: 'sub_id_mismatch', note: 'already has an active sub; ignoring stale event' };
      }
    } else {
      if (!sameSub) {
        return { action: 'ignore', reason: 'sub_id_mismatch', note: `stale deactivate for old sub ${subId}` };
      }
      if (currentSub.status === 'INACTIVE') {
        return { action: 'ignore', reason: 'already_inactive', note: 'duplicate deactivate event' };
      }
    }
  }

  return {
    action: isActivate ? 'activate' : 'deactivate',
    plan: isActivate ? 'premium' : 'free',
    note: isActivate ? 'upgrade' : 'downgrade',
  };
}

module.exports = { ACTIVATE_EVENTS, DEACTIVATE_EVENTS, decide };