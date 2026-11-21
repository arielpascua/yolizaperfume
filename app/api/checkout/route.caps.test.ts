// With no order link, anyone can post an order, so creation is capped: per source and globally. The caps
// are spent ONLY by a genuine order about to be filed, never by junk. Modules are reset per test so each
// test gets fresh limiters.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAGRANCES } from '@/lib/catalog/data';

let POST: (req: Request) => Promise<Response>;
let dir: string;
const sig = FRAGRANCES.find((f) => f.tier === 'signature' && f.inStock && f.volumes.includes('50ml'))!;

beforeEach(async () => {
  vi.resetModules();
  process.env.CHECKOUT_RATE_LIMIT_PER_MIN = '1000';
  process.env.CHECKOUT_IP_ORDERS_PER_10MIN = '3';
  process.env.CHECKOUT_ORDERS_PER_10MIN = '5';
  dir = mkdtempSync(path.join(tmpdir(), 'yz-caps-'));
  vi.stubEnv('LOCAL_STORE_DIR', dir);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('PAYMENT_PROVIDERS', '');
  vi.stubEnv('CHECKOUT_TEST_ITEM', '');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  POST = (await import('./route')).POST;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

type Kind = 'valid' | 'under-minimum';

const call = (ip: string, kind: Kind = 'valid') =>
  POST(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({
        buyer: { company: 'Casa Bella', contactName: 'Ana Reyes', email: 'ana@casabella.example', phone: '09171234567' },
        shipping: { line1: '1 Rizal St', city: 'Cebu City', postalCode: '6000', country: 'Philippines' },
        // 5 cases x 12 x PHP 880 clears the minimum; 1 case of the 10 ml does not.
        items: [kind === 'valid' ? { fragranceId: sig.id, volumeId: '50ml', cases: 5 } : { fragranceId: sig.id, volumeId: '10ml', cases: 1 }],
      }),
    }),
  );

describe('order creation caps', () => {
  it('limits one source to its allowance', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await call('10.0.0.1')).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const res = await call('10.0.0.1');
    expect((await res.json()).error).toMatch(/lot of orders/i);
  });

  it('does not let one source use up another source\'s allowance', async () => {
    for (let i = 0; i < 4; i += 1) await call('10.1.0.1');
    expect((await call('10.1.0.2')).status).toBe(200);
  });

  it('has a GLOBAL cap that many different sources cannot get around', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await call(`10.2.0.${i + 1}`)).status); // seven different addresses
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });

  it('is NOT spent by junk: below-minimum requests cost no allowance at either level', async () => {
    for (let i = 0; i < 30; i += 1) expect((await call('10.3.0.1', 'under-minimum')).status).toBe(400);
    for (let i = 0; i < 3; i += 1) expect((await call('10.3.0.1')).status).toBe(200);
    expect((await call('10.3.0.1')).status).toBe(429);
  });

  it('refuses before filing anything once a cap is hit', async () => {
    for (let i = 0; i < 3; i += 1) await call('10.4.0.1');
    const before = (await import('node:fs')).readdirSync(path.join(dir, 'orders')).length;
    expect((await call('10.4.0.1')).status).toBe(429);
    expect((await import('node:fs')).readdirSync(path.join(dir, 'orders')).length).toBe(before);
  });

  it('logs that a cap was hit without logging who hit it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 4; i += 1) await call('203.0.113.77');
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toMatch(/cap reached/);
    expect(logged).not.toContain('203.0.113.77');
  });
});
