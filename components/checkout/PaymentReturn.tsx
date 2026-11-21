'use client';

// /payment/return: where the buyer may land after Hexacorp's hosted card page.
//
// WHETHER HEXACORP SENDS THE BUYER BACK AT ALL, AND CARRYING WHAT, IS NOT DOCUMENTED: the payment
// request has no return/redirect URL field, only the server-to-server callback. So this page does not
// depend on a `ref` query parameter. It uses one when present and otherwise the reference this very
// browser stashed before it left (`yz_last_ref`). Nothing here can strand a payment: the order is
// settled by the webhook and the sweeper, neither of which needs the browser to land anywhere. What
// is at stake is only whether the buyer SEES a confirmation.
//
// The status shown ALWAYS comes from our own server (GET /api/orders/<ref>), which only reflects what
// an authenticated Transaction Inquiry decided. A query parameter is never treated as proof of
// anything: a buyer could edit it to claim a payment that did not happen.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // about 3 minutes, then offer a manual re-check

type Phase = 'polling' | 'timeout' | 'paid' | 'failed' | 'missing';

interface PollOrder {
  status: string;
  reference: string;
  totalCases: number;
  totalBottles: number;
}

function stored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function PaymentReturn() {
  const params = useSearchParams();
  const [reference, setReference] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('polling');
  const [order, setOrder] = useState<PollOrder | null>(null);
  const attempts = useRef(0);

  // Keyed on the STRING, not the params object, so the effect runs when the reference changes and
  // never merely because a new object was handed back.
  const refParam = params.get('ref');

  // sessionStorage is browser-only, so the reference is resolved after mount.
  useEffect(() => {
    const valid = (v: string | null): v is string => v !== null && /^YZ-[0-9A-F]{10}$/.test(v);
    const ref = valid(refParam) ? refParam : valid(stored('yz_last_ref')) ? stored('yz_last_ref') : null;
    setReference(ref);
    setPhase(ref ? 'polling' : 'missing');
    setReady(true);
  }, [refParam]);

  useEffect(() => {
    if (!ready || phase !== 'polling' || !reference) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (cancelled || !reference) return;
      attempts.current += 1;
      try {
        const token = stored(`yz_pay_token_${reference}`);
        const res = await fetch(`/api/orders/${reference}?token=${encodeURIComponent(token ?? '')}`);
        if (res.ok) {
          const data = (await res.json()) as PollOrder;
          if (cancelled) return;
          if (data.status === 'paid') {
            setOrder(data);
            setPhase('paid');
            return;
          }
          if (data.status === 'failed' || data.status === 'cancelled') {
            setPhase('failed');
            return;
          }
          // Still pending on our side: keep polling, a delayed webhook can still win.
        } else if (res.status === 404) {
          // Unknown reference, or this browser never held the token: nothing more to learn here.
          setPhase('missing');
          return;
        }
      } catch {
        // a transient network error: keep polling
      }
      if (cancelled) return;
      if (attempts.current >= MAX_POLL_ATTEMPTS) {
        setPhase('timeout');
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, phase, reference]);

  // The order page is public, so the way back is always the same address.
  const backToOrder = <Link href="/checkout" className="btn-primary mt-8">Back to the order page</Link>;

  if (phase === 'paid' && order) {
    return (
      <div role="status" className="mx-auto max-w-2xl border border-ink bg-papier-deep p-8 sm:p-12">
        <p className="label-muted">Payment received</p>
        <h1 className="mt-3 text-4xl italic leading-tight">Thank you. Your payment is confirmed.</h1>
        <p className="mt-4 text-lg">
          Reference <strong className="font-label font-medium tracking-wide">{order.reference}</strong>
        </p>
        <p className="mt-2 label-muted">{order.totalCases} cases · {order.totalBottles} bottles</p>
        <p className="mt-5 text-ink-muted">
          We will check stock and confirm your order in writing, with freight and any applicable taxes invoiced separately.
        </p>
      </div>
    );
  }

  if (phase === 'missing') {
    return (
      <div className="mx-auto max-w-xl py-10 text-center">
        <h1 className="text-4xl italic">We could not find that payment.</h1>
        <p className="mt-3 text-lg text-ink-muted">
          If you completed a payment, your order is safe: we will confirm it to you in writing.
        </p>
        <Link href="/" className="btn-quiet mt-8">Back to the home page</Link>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div role="status" className="mx-auto max-w-xl py-10 text-center">
        <h1 className="text-4xl italic">The payment did not go through.</h1>
        <p className="mt-3 text-lg text-ink-muted">
          Hexacorp reported this payment as unsuccessful. If your card was charged anyway, please do not pay again: we will
          confirm your order as soon as the payment is verified. Otherwise you can place the order again.
        </p>
        <p className="label-muted mt-4">Reference {reference}</p>
        {backToOrder}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <h1 className="text-4xl italic">Confirming your payment</h1>
      {reference ? <p className="label-muted mt-3">Reference {reference}</p> : null}
      <div role="status" aria-live="polite" className="mt-6">
        {phase === 'timeout' ? (
          <>
            <p className="text-ink-muted">
              This is taking longer than expected. Your order is saved and we will confirm it to you once the payment is
              verified. You can keep checking, or come back later.
            </p>
            <button
              type="button"
              className="btn-quiet mt-6"
              onClick={() => {
                attempts.current = 0;
                setPhase('polling');
              }}
            >
              Check again
            </button>
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-ink-muted">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
            Waiting for payment confirmation…
          </p>
        )}
      </div>
    </div>
  );
}
