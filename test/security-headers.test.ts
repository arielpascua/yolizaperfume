import { describe, expect, it } from 'vitest';
// @ts-expect-error next.config.mjs is plain JavaScript with no type declarations
import nextConfig, { securityHeaders } from '../next.config.mjs';

const byKey = (key: string): string | undefined =>
  (securityHeaders as { key: string; value: string }[]).find((h) => h.key === key)?.value;

describe('security headers ', () => {
  it('sends HSTS for two years including subdomains', () => {
    expect(byKey('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
  });

  it('sends a CSP limited to frame-ancestors, object-src, base-uri and form-action', () => {
    const csp = byKey('Content-Security-Policy')!;
    expect(csp).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
    // script-src / default-src need nonces and would break Next: they must NOT be here.
    expect(csp).not.toMatch(/script-src|default-src|style-src|img-src|connect-src/);
  });

  it('keeps the existing hardening headers', () => {
    expect(byKey('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey('X-Frame-Options')).toBe('DENY');
    expect(byKey('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(byKey('Permissions-Policy')).toContain('camera=()');
  });

  it('applies them to every path through next.config headers()', async () => {
    const rules = await nextConfig.headers();
    expect(rules).toEqual([{ source: '/:path*', headers: securityHeaders }]);
  });
});
