import { describe, expect, it } from 'vitest';
import { clientIp, createLimiter } from '@/lib/checkout/rate-limit';

describe('createLimiter (Review Focus 4)', () => {
  it('allows up to the limit per key per window, then refuses', () => {
    let t = 0;
    const limiter = createLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect([1, 2, 3, 4].map(() => limiter.allow('a'))).toEqual([true, true, true, false]);
    expect(limiter.allow('b')).toBe(true);
  });

  it('opens a fresh window after windowMs', () => {
    let t = 0;
    const limiter = createLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    t = 1000;
    expect(limiter.allow('a')).toBe(true);
  });

  it('never tracks more than the key cap, however many distinct keys arrive', () => {
    const t = 0;
    const limiter = createLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    let max = 0;
    for (let i = 0; i < 25_000; i += 1) {
      limiter.allow(`key-${i}`);
      max = Math.max(max, limiter.size());
    }
    expect(max).toBeLessThanOrEqual(10_000);
    expect(limiter.size()).toBe(10_000);
  });

  it('evicts the OLDEST entries first when the cap is reached', () => {
    const t = 0;
    const limiter = createLimiter({ limit: 1, windowMs: 60_000, now: () => t });
    for (let i = 0; i < 10_000; i += 1) limiter.allow(`key-${i}`);
    limiter.allow('newcomer'); // evicts key-0, the oldest
    expect(limiter.allow('key-9999')).toBe(false); // still tracked, still limited
    expect(limiter.allow('key-0')).toBe(true); // forgotten, starts a fresh window
  });

  it('treats an oversized key as its 64-character prefix', () => {
    const t = 0;
    const limiter = createLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(limiter.allow('x'.repeat(10_000))).toBe(true);
    expect(limiter.allow('x'.repeat(64) + 'different tail')).toBe(false);
    expect(limiter.size()).toBe(1);
  });

  it('prunes expired entries at most once per window', () => {
    let t = 0;
    const limiter = createLimiter({ limit: 5, windowMs: 1000, now: () => t });
    limiter.allow('a'); // expires at 1000
    t = 999;
    limiter.allow('b'); // expires at 1999
    expect(limiter.size()).toBe(2);
    t = 1000;
    limiter.allow('c'); // a expired; a window has passed since the last prune -> prune
    expect(limiter.size()).toBe(2); // b, c
    t = 1999;
    limiter.allow('d'); // b is expired but only 999ms since the last prune -> NO prune
    expect(limiter.size()).toBe(3); // b, c, d
    t = 2000;
    limiter.allow('e'); // a full window since the last prune -> prune b and c
    expect(limiter.size()).toBe(2); // d, e
  });
});

describe('clientIp', () => {
  it('uses the first x-forwarded-for entry, then x-real-ip, then "unknown"', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe('203.0.113.5');
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
