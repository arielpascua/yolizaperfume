// Philippine mobile number normalisation, shared by the order form (client) and the server
// (app/api/checkout/route.ts, lib/payments/hexacorp.ts): one definition of "valid", and no
// server-only imports, so a 'use client' component can use it.
//
// Hexacorp's Credit Card Payment accepts `merchant_details.mobile_number` in exactly two shapes,
// per its own error text: "Enter a valid Philippine mobile number (e.g. 09123456789 or
// 639123456789)." Spaces, dashes, parentheses and a leading `+` are REJECTED, although every one
// of those is how a person naturally types a number. So this NORMALISES common variations
// rather than merely validating: refusing a buyer's order over their own punctuation, when the
// fix is stripping a few characters, would be the worse failure.

const ACCEPTED_09 = /^09\d{9}$/;
const ACCEPTED_639 = /^639\d{9}$/;
/** Missing the leading 0 (e.g. pasted without it): confidently recoverable. */
const MISSING_LEADING_ZERO = /^9\d{9}$/;

/**
 * Normalises `raw` to one of Hexacorp's two accepted shapes, or returns `null` when that cannot
 * be done with confidence: never a guess. Strips everything but digits first, so
 * `+63 917 000 0000`, `0917-000-0000` and `09170000000` all normalise identically.
 */
export function normalizePhMobileNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (ACCEPTED_09.test(digits)) return digits;
  if (ACCEPTED_639.test(digits)) return digits;
  if (MISSING_LEADING_ZERO.test(digits)) return `0${digits}`;
  return null;
}
