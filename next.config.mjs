import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CSP is deliberately LIMITED to the directives that need no per-request nonce.
// A script-src/default-src policy would have to allow Next's inline bootstrap
// scripts via nonces (or 'unsafe-inline', which defeats it) and would break the
// site if it were wrong; framing, plugins, <base> and form targets are safe now.
export const CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

export const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Every bottle is inline SVG and the site ships no raster images, so the image optimizer stays off.
  images: { unoptimized: true },
  // Pin file tracing to this project: a stray lockfile in a parent directory makes Next guess wrongly.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
