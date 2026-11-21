// Which way checkout takes money. Server only (reads the environment).
//
//   PAYMENT_PROVIDERS unset or blank -> 'invoice': the order is filed `pending` and a person sends an
//                                       invoice. No gateway is called.
//   PAYMENT_PROVIDERS=hexacorp       -> 'card': the order is filed `pending`, the buyer is sent to
//                                       Hexacorp's hosted card page, and only an authenticated
//                                       Transaction Inquiry can mark it paid.
//
// A provider that is LISTED but not fully configured does not quietly fall back to invoice mode:
// checkout answers 503 for it (see app/api/checkout/route.ts). Listing a gateway is an explicit
// statement that orders are paid there, so a missing credential must stop the order, not hide.

import { hexacorpProvider } from './hexacorp';
import type { PaymentProvider } from './types';

export type PaymentMode = 'invoice' | 'card';

const KNOWN = ['hexacorp'];

export function requestedProviders(env: Record<string, string | undefined> = process.env): string[] {
  const names = (env.PAYMENT_PROVIDERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const known = names.filter((n) => KNOWN.includes(n));
  for (const n of names) {
    if (!KNOWN.includes(n)) console.warn('[payments] ignoring unknown provider in PAYMENT_PROVIDERS', { name: n });
  }
  return known;
}

export function paymentMode(env: Record<string, string | undefined> = process.env): PaymentMode {
  return requestedProviders(env).length > 0 ? 'card' : 'invoice';
}

/** The provider checkout uses in card mode. Never falls back to a default. */
export function cardProvider(): PaymentProvider {
  return hexacorpProvider;
}

/**
 * Scheme + host of THIS deployment, for the webhook URL. It ALWAYS comes from NEXT_PUBLIC_SITE_URL
 * and must be https, in every environment: the request's own Host header is attacker-influenced and
 * must never decide where a payment provider is told to call back, and Hexacorp requires an https
 * callback anyway. To try card mode from a laptop, set NEXT_PUBLIC_SITE_URL to a public https
 * tunnel. (The parameter is kept so callers read as "resolve against this request", but the
 * request's own origin is never returned.)
 */
export function resolveOrigin(_requestOrigin: string, env: Record<string, string | undefined> = process.env): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) throw new Error('NEXT_PUBLIC_SITE_URL is not set');
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('NEXT_PUBLIC_SITE_URL is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error('NEXT_PUBLIC_SITE_URL must be https');
  return url.origin;
}
