// GET /api/orders/<reference>?token=<callback token>  ->  { status, reference, totalCases, totalBottles }
//
// The poll target for /payment/return: the page the buyer may land on coming back from Hexacorp's
// hosted card page. The buyer has no session, so the unguessable `token` that checkout handed them
// (and that they stashed in their own browser) must match the order's callback token.
//
// READS ONLY. It never triggers a reconcile: only the webhook and the sweeper do, and both
// reconcile against an authenticated status query. It returns no contact details and no address,
// and every failure to authorise looks the same whether or not the order exists.

import { NextRequest, NextResponse } from 'next/server';
import { clientIp, createLimiter } from '@/lib/checkout/rate-limit';
import { findOrderByReference, safeTokenEqual } from '@/lib/server/orders';
import { StoreUnavailableError } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

// The page polls every 3 seconds for about 3 minutes, so the budget is generous but finite.
const limiter = createLimiter({ limit: 120, windowMs: 60_000 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  if (!limiter.allow(clientIp(request.headers))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const { reference } = await params;
  const token = request.nextUrl.searchParams.get('token') ?? '';

  let order;
  try {
    order = await findOrderByReference(reference);
  } catch (err) {
    if (err instanceof StoreUnavailableError) {
      return NextResponse.json({ error: 'Temporarily unavailable' }, { status: 503 });
    }
    throw err;
  }

  // One answer for "no such order", "no token" and "wrong token".
  if (!order || !token || !order.callbackToken || !safeTokenEqual(order.callbackToken, token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    status: order.status,
    reference: order.reference,
    totalCases: order.totalCases,
    totalBottles: order.totalBottles,
  });
}
