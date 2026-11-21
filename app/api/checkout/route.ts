// POST /api/checkout
//
// The ONE checkout, open to anyone at /checkout (there is no order link any more). Because anyone can
// call it, every protection that used to ride on the link now rests on the server alone: prices and
// totals are recomputed here from ids and case counts, an order is only ever filed after the quote, the
// minimum and the phone check pass, and creation is capped per source and globally (see below).
//
// PRICES ARE SERVER-SIDE ONLY. The body carries ids and case counts; anything else about price is
// never read. lib/pricing.ts is the only price authority.
//
// TWO MODES, chosen by PAYMENT_PROVIDERS (lib/payments/config.ts):
//   invoice (unset)    the order is filed `pending` and a person sends the invoice.
//   card (=hexacorp)   the order is filed `pending`, a Hexacorp card payment is created, and the
//                      buyer is sent to Hexacorp's hosted page (a full-page redirect, never an
//                      iframe). The order becomes `paid` ONLY when lib/server/paymentReconcile.ts
//                      sees an authenticated Transaction Inquiry say so. Nothing in THIS file, and
//                      no browser, can mark an order paid.
//
// SUCCESS MEANS THE ORDER WAS SAVED, and in card mode that a payment page exists. A failed write is
// an honest 503 and no gateway is called. NOTHING IN THIS FILE LOGS CONTACT DATA.

import { NextResponse } from 'next/server';
import { CheckoutError } from '@/lib/checkout/parse';
import { parseOrder } from '@/lib/checkout/parse-order';
import { checkoutLimiter, clientIp, createLimiter } from '@/lib/checkout/rate-limit';
import { readBodyLimited } from '@/lib/checkout/read-body';
import type { OrderResponse } from '@/lib/checkout/types';
import { formatPeso } from '@/lib/format';
import { cardProvider, paymentMode, resolveOrigin } from '@/lib/payments/config';
import { isTrustedPaymentUrl } from '@/lib/payments/trusted-url';
import { PaymentApiError, PaymentConfigError } from '@/lib/payments/types';
import { normalizePhMobileNumber } from '@/lib/phone';
import { QuoteError, quote } from '@/lib/pricing';
import { markOrderFailed, newCallbackToken, newOrderReference, recordOrder, setPaymentId } from '@/lib/server/orders';
import { StoreUnavailableError } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * CAPS ON ORDER CREATION. With no order link, anyone can post an order, and in card mode every order is a
 * real payment attempt at Hexacorp plus an unpaid row the sweeper must keep checking. Two caps, both
 * spent ONLY by a genuine order about to be filed (never by invalid, below-minimum or refused requests):
 *   - per source: a real buyer places a handful of orders, default 5 per 10 minutes. The source is read
 *     from a forwarding header the client can influence, so this raises the bar and no more;
 *   - global: the hard backstop, default 30 per 10 minutes across everyone. It cannot be spoofed.
 * The cost of the global cap is real and accepted: a determined caller can use it up and pause ordering
 * for up to ten minutes. That is an availability loss, never a money or data one.
 * Both are per server instance and reset on a deploy.
 */
function limitFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
const sourceOrderLimiter = createLimiter({ limit: limitFromEnv('CHECKOUT_IP_ORDERS_PER_10MIN', 5), windowMs: 10 * 60_000 });
const globalOrderLimiter = createLimiter({ limit: limitFromEnv('CHECKOUT_ORDERS_PER_10MIN', 30), windowMs: 10 * 60_000 });
const UNAVAILABLE = 'We could not place your order just now. Nothing has been sent. Please try again in a moment.';
const UNAVAILABLE_CARD = 'Card payment is temporarily unavailable. Nothing has been charged. Please try again shortly.';

/**
 * Hexacorp wants first and last name separately. Everything after the first space is the last
 * name; a single word is used for both. This is display metadata on the gateway's side, not an
 * identity check.
 */
function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const i = trimmed.indexOf(' ');
  if (i === -1) return { firstName: trimmed, lastName: trimmed };
  return { firstName: trimmed.slice(0, i), lastName: trimmed.slice(i + 1).trim() };
}

export async function POST(request: Request) {
  try {
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      throw new CheckoutError('Content-Type must be application/json', 415);
    }
    if (!checkoutLimiter.allow(clientIp(request.headers))) {
      throw new CheckoutError('Too many requests. Please wait a moment and try again.', 429);
    }

    const text = await readBodyLimited(request, MAX_BODY_BYTES);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CheckoutError('Request body must be valid JSON', 400);
    }
    const order = parseOrder(body);

    const priced = quote(order.lines);
    if (!priced.meetsMinimum) {
      throw new CheckoutError(
        `The minimum order is ${formatPeso(priced.minimumOrder)}. Your order is ${formatPeso(priced.total)}. Please add more cases.`,
        400,
      );
    }

    const mode = paymentMode();
    const provider = mode === 'card' ? cardProvider() : null;

    // Card mode needs three things BEFORE any order is filed or gateway called, so a refusal leaves
    // nothing behind: a configured gateway, an origin for the webhook URL, and a phone Hexacorp accepts.
    let origin = '';
    let cardPhone = '';
    if (provider) {
      if (!provider.isConfigured()) {
        console.error('[order] card payment is requested (PAYMENT_PROVIDERS) but the gateway is not configured');
        throw new CheckoutError(UNAVAILABLE_CARD, 503);
      }
      try {
        origin = resolveOrigin(new URL(request.url).origin);
      } catch (err) {
        console.error('[order] cannot determine the origin for the payment callback', {
          message: err instanceof Error ? err.message : 'unknown',
        });
        throw new CheckoutError(UNAVAILABLE_CARD, 503);
      }
      const phone = normalizePhMobileNumber(order.buyer.phone);
      if (!phone) {
        throw new CheckoutError('Enter a Philippine mobile number for card payment, for example 0917 123 4567.', 400);
      }
      cardPhone = phone;
    }

    // The caps are spent ONLY here, once the order is genuine and about to be filed: after the quote, the
    // minimum and the phone checks. Junk requests that file nothing and call no gateway cost no allowance.
    const source = clientIp(request.headers);
    if (!sourceOrderLimiter.allow(source) || !globalOrderLimiter.allow('all')) {
      console.warn('[order] order creation cap reached');
      throw new CheckoutError('We are receiving a lot of orders right now. Please wait a few minutes and try again.', 429);
    }

    const reference = newOrderReference();
    const callbackToken = newCallbackToken();
    await recordOrder({
      reference,
      // Kept for the table's shape. Orders made while a signed link was required hold that link's id.
      linkId: 'public',
      callbackToken,
      paymentProvider: provider ? provider.name : null,
      buyer: order.buyer,
      shipping: order.shipping,
      poNumber: order.poNumber,
      notes: order.notes,
      totals: {
        cases: priced.totalCases,
        bottles: priced.totalBottles,
        subtotal: priced.subtotal,
        discountPercent: priced.discountPercent,
        discount: priced.discount,
        total: priced.total,
      },
      lines: priced.lines.map((l) => ({
        fragranceId: l.fragranceId,
        fragranceName: l.fragranceName,
        volumeId: l.volumeId,
        volumeLabel: l.volumeLabel,
        cases: l.cases,
        casePack: l.casePack,
        bottles: l.bottles,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    });

    console.info('[order] received', { reference, lines: priced.lines.length, cases: priced.totalCases, mode });
    const response: OrderResponse = {
      mode: provider ? 'card' : 'invoice',
      reference,
      totalCases: priced.totalCases,
      totalBottles: priced.totalBottles,
      subtotal: priced.subtotal,
      discountPercent: priced.discountPercent,
      discount: priced.discount,
      total: priced.total,
    };
    if (!provider) return NextResponse.json(response);

    // CARD MODE. The order is saved; now ask Hexacorp for a payment page.
    //
    // THE BUYER IS SENT TO PAY ONLY WHEN THE PAYMENT CAN BE FOUND AGAIN. Hexacorp's reference_number is
    // the only key Transaction Inquiry takes, so a payment whose reference we failed to store could be
    // paid and then never matched to this order, by the webhook or the sweeper. Therefore that write is
    // NOT best-effort: if it fails, the order is failed and no payment page is handed out.
    let hexacorpReference: string | undefined;
    try {
      const { firstName, lastName } = splitName(order.buyer.contactName);
      const { providerPaymentId, checkoutUrl } = await provider.createPayment({
        referenceId: reference,
        // WHOLE PESOS, equal to the order total. Hexacorp takes a decimal-peso STRING and
        // lib/payments/hexacorp.ts formats it. Never multiply by 100 here.
        amountPesos: priced.total,
        customer: { firstName, lastName, email: order.buyer.email, phone: cardPhone },
        origin,
      });
      hexacorpReference = providerPaymentId;

      // Validated HERE as well as in the browser: the server should not hand out a URL it would not
      // itself navigate to. A bad URL is a failed order, with its reference kept for recovery.
      if (!isTrustedPaymentUrl(checkoutUrl)) {
        console.error('[order] Hexacorp returned a payment URL that is not an https page on hexacorp.xyz: not handing it out', { reference });
        throw new PaymentApiError('Untrusted payment URL', 502, null, providerPaymentId);
      }

      // Throws StoreUnavailableError on failure, which the handler below turns into a failed order.
      await setPaymentId(reference, providerPaymentId);

      // The host only: the query and hash are where a payment token would live.
      console.info('[order] card payment created', { reference, checkoutHost: new URL(checkoutUrl).host });
      // `token` authorises THIS browser's polling once it returns from Hexacorp (no session exists).
      return NextResponse.json({ ...response, redirectUrl: checkoutUrl, token: callbackToken });
    } catch (err) {
      // Hexacorp may have ACCEPTED the transaction and still failed the exchange. Keep its reference
      // so a payment completed anyway can still be found, then fail the order.
      const known = err instanceof PaymentApiError && err.providerPaymentId ? err.providerPaymentId : hexacorpReference;
      let stored = false;
      if (known) {
        stored = await setPaymentId(reference, known).then(() => true, () => false);
      }
      // A CREATE that did not complete is INDETERMINATE: Hexacorp may hold a transaction we cannot see.
      // Calling that order `failed` would hide it from the sweeper (which skips failed orders with no
      // reference). Left `pending` with no reference it is reported as UNREFERENCED, the scheduled run
      // goes red, and a person checks Hexacorp's records for this txn_ref.
      const indeterminate = err instanceof PaymentApiError && err.indeterminate === true && !known;
      if (indeterminate) {
        console.error('[order] card payment create did not complete: the order is left pending for a person to check', { reference });
      } else {
        await markOrderFailed(reference).catch(() => undefined);
      }
      if (known && !stored) {
        // The one case with no safety net: a Hexacorp transaction exists that this order cannot point
        // at. The reference is logged (it is Hexacorp's id, not a secret) so a person can match it.
        console.error('[order] ORPHANED PAYMENT RISK: Hexacorp holds a transaction this order could not store', {
          reference,
          hexacorpReference: known,
        });
      }
      if (err instanceof PaymentConfigError) {
        console.error('[order] payment provider is not configured', err);
        throw new CheckoutError(UNAVAILABLE_CARD, 503);
      }
      if (err instanceof PaymentApiError) {
        throw new CheckoutError('We could not start the card payment. Nothing has been charged. Please try again in a moment.', 502);
      }
      if (err instanceof StoreUnavailableError) {
        throw new CheckoutError('We could not start the card payment. Nothing has been charged. Please try again in a moment.', 502);
      }
      throw err;
    }
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: error.status === 429 ? { 'Retry-After': '60' } : undefined },
      );
    }
    if (error instanceof QuoteError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof StoreUnavailableError) {
      console.error('[order] unavailable', error);
      return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }
    console.error('[order] unexpected failure', { name: error instanceof Error ? error.name : 'unknown' });
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
