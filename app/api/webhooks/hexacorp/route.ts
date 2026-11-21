// POST /api/webhooks/hexacorp?k=<HEXACORP_WEBHOOK_SECRET>  -> 200 { received: true }
// GET  /api/webhooks/hexacorp                              -> 200 { ok: true }
//
// SECURITY-CRITICAL. The callback BODY is documented ({txn_ref, reference_number, status, amount});
// its AUTHENTICITY is not: Hexacorp documents no signature, shared secret or IP allowlist. So every
// delivery is treated as UNSIGNED:
//
//   (a) a secret in the callback URL we hand Hexacorp on every payment, compared CONSTANT-TIME;
//   (b) a reference must be PRESENT before anything is trusted;
//   (c) status is decided ONLY by an authenticated re-fetch inside the shared reconcile (Transaction
//       Inquiry, queried with the `reference_number` stored on the ORDER at create time, never an id
//       read out of this delivery). The delivered `status` and `amount` are NEVER READ: the body is
//       nothing more than a "go reconcile" signal;
//   (d) writes are idempotent: a settled order is never revisited. The same status may be delivered
//       more than once.
//
// GET is deliberate. Hexacorp checks a payment's callback_url for reachability SYNCHRONOUSLY when the
// payment is created, and the probe method is unconfirmed; Next serves HEAD wherever GET exists, so
// this covers both. It does no lookup and holds no secret check: a bare liveness ping.

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { findOrderByPaymentId, findOrderByReference, type StoredOrder } from '@/lib/server/orders';
import { reconcileOrder } from '@/lib/server/paymentReconcile';

export const dynamic = 'force-dynamic';

function secretMatches(provided: string | null): boolean {
  const expected = process.env.HEXACORP_WEBHOOK_SECRET?.trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function firstString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '';
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function POST(request: NextRequest) {
  if (!process.env.HEXACORP_WEBHOOK_SECRET?.trim()) {
    console.error('[hexacorp-webhook] HEXACORP_WEBHOOK_SECRET is not set: cannot authenticate deliveries');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (!secretMatches(request.nextUrl.searchParams.get('k'))) {
    console.warn('[hexacorp-webhook] rejected a delivery with a missing or invalid URL secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Two DIFFERENT identifiers: `txn_ref` is ours (the order reference); `reference_number` is
  // Hexacorp's, stored as the order's payment id. txn_ref first, reference_number as the fallback.
  const txnRef = firstString(payload, 'txn_ref');
  const hexacorpReference = firstString(payload, 'reference_number');
  if (!txnRef && !hexacorpReference) {
    console.warn('[hexacorp-webhook] rejected: no txn_ref or reference_number in the payload', { keys: Object.keys(payload) });
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  console.info('[hexacorp-webhook] delivery received', { keys: Object.keys(payload), hasTxnRef: Boolean(txnRef) });

  let order: StoredOrder | null;
  try {
    order = txnRef ? await findOrderByReference(txnRef) : await findOrderByPaymentId(hexacorpReference);
  } catch (err) {
    // The store is down: ack 200 so Hexacorp does not hammer us; the sweeper recovers it.
    console.error('[hexacorp-webhook] could not look the order up', { name: err instanceof Error ? err.name : 'unknown' });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Unknown, or an order that is not on this gateway: indistinguishable to the caller.
  if (!order || order.paymentProvider !== 'hexacorp') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Both identifiers used come from the ORDER ROW we just read, never from this delivery.
    await reconcileOrder(order);
  } catch (err) {
    // Ack 200 even so: a retry cannot fix our own failure, and the sweeper is the recovery path.
    // Name, message and HTTP status only. Never the error object itself: a PaymentApiError carries
    // the gateway's raw response body, which is exactly what must not reach a log unredacted.
    console.error('[hexacorp-webhook] reconcile failed', {
      reference: order.reference,
      name: err instanceof Error ? err.name : 'unknown',
      message: err instanceof Error ? err.message : 'unknown',
      status: typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined,
    });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
