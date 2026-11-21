// POST /api/admin/orders/reconcile              -> sweep unsettled card orders (pending, and recently failed)
// POST /api/admin/orders/reconcile?ref=YZ-XXXXXXXXXX -> reconcile just that one
//   -> 200 { swept, changed, attention, truncated, outcomes[], errors[] }
//
// WHY THIS EXISTS: a webhook delivery can be lost, rejected or never retried, and a buyer who paid
// must not wait on that. This pulls the truth from Hexacorp for each unpaid card order instead of
// waiting to be pushed. It is the recovery path, not a backstop.
//
// SECURITY: reconciliation is delegated to the SAME `reconcileOrder` the webhook uses, so status
// still comes only from an authenticated Transaction Inquiry, the amount is still bound before
// `paid`, and writes are still idempotent. This endpoint decides only WHICH orders to reconcile,
// never what they become.
//
// AUTH: `Authorization: Bearer <RECONCILE_SECRET>` only (there are no admin sessions on this site).
// With RECONCILE_SECRET unset the route answers 403 to everyone: never open access.

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ORDER_REFERENCE_RE, findOrderByReference, listUnsettledByProvider, touchChecked, type StoredOrder } from '@/lib/server/orders';
import { needsAttention, reconcileOrder, type ReconcileOutcome } from '@/lib/server/paymentReconcile';
import { StoreUnavailableError } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

/** Give the webhook a chance to land before pulling, so the sweep does not race it. */
const MIN_AGE_MS = 2 * 60 * 1000;
/** A generous ceiling on how far back one sweep looks at unpaid orders. */
const MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
/**
 * `failed` is not final (a declined payer can retry on Hexacorp's page and succeed), so recent failures
 * are re-checked too, but only for two days: old failures must not fill the sweep and starve real work.
 */
const FAILED_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
/**
 * Bound the work per invocation, with SEPARATE budgets. One shared oldest-first list can be starved:
 * abandoned checkouts stay pending for the whole window and would crowd out every newer order,
 * failed ones included. Each list is also round-robin (least recently checked first), so nothing
 * waits behind the same orders forever. Each order costs two HTTP calls to Hexacorp, so the total
 * stays well inside the scheduled job's two-minute ceiling.
 */
const PENDING_BUDGET = 40;
const FAILED_BUDGET = 20;

function authorised(request: NextRequest): boolean {
  const expected = process.env.RECONCILE_SECRET?.trim();
  // A short secret is as good as none: refuse everyone rather than accept a guessable bearer.
  if (!expected || expected.length < 16) return false;
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice('Bearer '.length));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const ref = request.nextUrl.searchParams.get('ref');
  let orders: StoredOrder[];
  let truncated = false;
  try {
    if (ref) {
      if (!ORDER_REFERENCE_RE.test(ref)) return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
      // A targeted recovery skips the age window: an operator can fix it the moment they spot it.
      const one = await findOrderByReference(ref);
      // ANY status: an operator asking about one order gets the answer, including a confirmed payment on an
      // order that was cancelled (reconcile flags that as unresolved rather than ignoring it).
      orders = one && one.paymentProvider === 'hexacorp' ? [one] : [];
    } else {
      const sweep = await listUnsettledByProvider('hexacorp', {
        minAgeMs: MIN_AGE_MS,
        maxAgeMs: MAX_AGE_MS,
        failedMaxAgeMs: FAILED_MAX_AGE_MS,
        pendingLimit: PENDING_BUDGET,
        failedLimit: FAILED_BUDGET,
      });
      orders = sweep.orders;
      truncated = sweep.truncated;
    }
  } catch (err) {
    if (err instanceof StoreUnavailableError) {
      console.error('[payment-reconcile] failed to list pending orders', err);
      return NextResponse.json({ error: 'Failed to list pending orders' }, { status: 502 });
    }
    throw err;
  }

  const outcomes: ReconcileOutcome[] = [];
  const errors: { reference: string; message: string }[] = [];
  for (const order of orders) {
    try {
      outcomes.push(await reconcileOrder(order));
    } catch (err) {
      // One bad order must not abort the sweep.
      const message = err instanceof Error ? err.message : 'unknown error';
      console.error('[payment-reconcile] failed', { reference: order.reference, message });
      errors.push({ reference: order.reference, message });
    } finally {
      // Round-robin bookkeeping, best-effort, and it runs for a FAILED reconcile too. An order that
      // throws on every run (an inquiry answer we cannot read, say) must still go to the back of the
      // queue: left at the front it would, with enough like it, starve every other order again.
      await touchChecked(order.reference).catch(() => undefined);
    }
  }

  // Anything a person must look at: a refused payment, an order with no reference, an unmappable status.
  const attention = outcomes.filter(needsAttention).length;
  return NextResponse.json({
    swept: orders.length,
    changed: outcomes.filter((o) => o.changed).length,
    attention,
    // True when a budget was filled: there may be orders this sweep did not reach. The next sweep starts
    // with whoever has waited longest, but a persistent backlog is worth a person's attention.
    truncated,
    outcomes,
    errors,
  });
}
