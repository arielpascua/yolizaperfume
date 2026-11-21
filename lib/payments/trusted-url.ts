// Client-safe. The browser only ever navigates to an https page on Hexacorp's own domain.
//
// `redirectUrl` comes back from POST /api/checkout, and assigning an unvalidated string to
// `location.href` would run a `javascript:` payload in OUR origin if that response were ever
// tampered with. The allowlist is the apex domain on purpose: a hosted page routinely lives on a
// different subdomain from the API that mints the URL, and allowlisting only the API host would
// make every checkout fail with the browser, correctly, refusing to navigate.

const HEXACORP_HOST = /(^|\.)hexacorp\.xyz$/i;

export function isTrustedPaymentUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && HEXACORP_HOST.test(url.hostname) && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
