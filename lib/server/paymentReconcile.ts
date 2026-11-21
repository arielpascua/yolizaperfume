import 'server-only';
// The single reconcile path, shared by BOTH callers: the Hexacorp webhook
// (app/api/webhooks/hexacorp) and the sweeper (app/api/admin/orders/reconcile).
//
// One function so the callers cannot drift apart on the properties that matter:
//
//   - status comes ONLY from `provider.getPaymentStatus()`, an authenticated Transaction Inquiry,
//     never from a webhook body. The webhook is treated as entirely unsigned: it is a "go
//     reconcile" signal and nothing more;
//   - the reported amount is bound to the order total before anything is marked paid, and a
//     MISSING amount blocks too;
//   - the fetched record's reference must not contradict the order's;
//   - writes are idempotent: a settled order is never revisited.
//
// SILENCE IS THE ENEMY. A sweeper that reports "nothing changed" while a buyer's payment sits
// unsettled is the worst outcome here, so every case where an order cannot be settled but might
// need to be is a named outcome the sweeper counts and fails its run on:
//   blockedByAmountMismatch / blockedByReferenceMismatch  a real payment was refused
//   unreferenced                                          a card order with no stored reference_number
//   unresolved                                            Hexacorp answered with a status we cannot
//                                                         map, or records that contradict each other

import { hexacorpProvider } from '@/lib/payments/hexacorp';
import type { PaymentProvider } from '@/lib/payments/types';
import { applyOrderStatus, paymentAmountMismatches, type OrderStatus, type StoredOrder } from './orders';

export interface ReconcileOutcome {
  reference: string;
  from: OrderStatus;
  to: OrderStatus;
  changed: boolean;
  /** A `paid` result was refused because the amount did not match (or was absent). */
  blockedByAmountMismatch?: boolean;
  /** Refused because the fetched payment carried a different merchant reference. */
  blockedByReferenceMismatch?: boolean;
  /** A card order with no stored Hexacorp reference: it cannot be looked up, and needs a person. */
  unreferenced?: boolean;
  /** Hexacorp reported a status we do not recognise, or contradictory records: left untouched. */
  unresolved?: boolean;
}

/** Outcomes that mean "a person must look at this order". */
export function needsAttention(o: ReconcileOutcome): boolean {
  return Boolean(o.blockedByAmountMismatch || o.blockedByReferenceMismatch || o.unreferenced || o.unresolved);
}

const PROVIDERS: Record<string, PaymentProvider> = { hexacorp: hexacorpProvider };

export function providerFor(name: string | null): PaymentProvider | null {
  return name !== null && Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? PROVIDERS[name] : null;
}

/**
 * Reconciles one order against its OWN gateway's authenticated status and applies the result.
 * Throws if the status fetch itself fails: the webhook still acks 200 (a retry cannot fix our
 * failure), and the sweeper records the error and moves on.
 */
export async function reconcileOrder(order: StoredOrder, provider: PaymentProvider | null = providerFor(order.paymentProvider)): Promise<ReconcileOutcome> {
  const from = order.status;
  const base = { reference: order.reference, from, to: from, changed: false };
  if (!provider) {
    // An order with no gateway (invoice mode, or a de-registered one) has nothing to ask.
    return base;
  }

  // Inquiry is keyed on Hexacorp's reference_number and ONLY that. Without one the order cannot be
  // looked up at all, and asking with our own reference would answer "no transaction" for a payment
  // that may exist. Say so loudly instead.
  if (!order.paymentId) {
    console.error('[payment-reconcile] card order has no stored Hexacorp reference: it cannot be reconciled', {
      reference: order.reference,
      status: order.status,
    });
    return { ...base, unreferenced: true };
  }

  // `order.paymentId` is read off OUR row. It is never a value taken from a webhook body.
  const status = await provider.getPaymentStatus({ referenceId: order.reference, providerPaymentId: order.paymentId });

  // Asymmetric on purpose: a present-and-different reference blocks; an absent one does not, so an
  // omission by the provider can never strand a genuine payment. getPaymentStatus enforces this too;
  // this is the second, independent gate.
  if (status.requestReferenceNumber !== undefined && status.requestReferenceNumber !== order.reference) {
    console.error('[payment-reconcile] REFUSING to reconcile: the fetched payment belongs to a different order', {
      reference: order.reference,
      fetched: status.requestReferenceNumber,
    });
    return { ...base, blockedByReferenceMismatch: true };
  }

  // Never mark an order paid for an amount that differs from what we asked, nor on an amount we
  // could not read. Left as it is for a person.
  if (status.orderStatus === 'paid' && paymentAmountMismatches(status.amountPesos, order.total)) {
    console.error('[payment-reconcile] REFUSING to mark paid: the reported amount does not match the order', {
      reference: order.reference,
      expectedPesos: order.total,
      reportedAmount: status.amountPesos,
    });
    return { ...base, blockedByAmountMismatch: true };
  }

  // A success that a later record contradicts. Flagged explicitly: the contradicting record may carry
  // no status string of its own, and "no status" must not read as "nothing to do".
  if (status.ambiguous) {
    console.error('[payment-reconcile] UNRESOLVED: Hexacorp records for this payment contradict each other', {
      reference: order.reference,
    });
    return { ...base, unresolved: true };
  }

  // A CONFIRMED, correctly-valued payment on an order a person has since moved elsewhere (cancelled,
  // invoiced, shipped). It must not be silently ignored: money was taken for an order that is not
  // open any more. Only pending and failed orders may be moved by a payment result.
  if (status.orderStatus === 'paid' && order.status !== 'pending' && order.status !== 'failed' && order.status !== 'paid') {
    console.error('[payment-reconcile] UNRESOLVED: a confirmed payment arrived for an order that is no longer open', {
      reference: order.reference,
      orderStatus: order.status,
    });
    return { ...base, unresolved: true };
  }

  // Hexacorp DID answer with a status, but it maps to nothing (or the records contradict each
  // other). That must not look like "nothing to do": a charged buyer could sit unsettled forever.
  if (status.rawStatus !== undefined && status.orderStatus === null) {
    console.error('[payment-reconcile] UNRESOLVED: Hexacorp reported a status that cannot be mapped', {
      reference: order.reference,
      rawStatus: status.rawStatus,
    });
    return { ...base, unresolved: true };
  }

  const next = await applyOrderStatus(order, status.orderStatus);
  return { reference: order.reference, from, to: next, changed: from !== next };
}
