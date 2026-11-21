import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileOrder, setupStore, teardownStore } from '@/test/payment-helpers';
import { applyOrderStatus } from '@/lib/server/orders';
import { GET } from './route';

beforeEach(() => {
  setupStore();
});
afterEach(() => teardownStore());

const get = (reference: string, token?: string, ip = '10.0.0.1') =>
  GET(
    new NextRequest(`http://localhost/api/orders/${reference}${token === undefined ? '' : `?token=${encodeURIComponent(token)}`}`, {
      headers: { 'x-forwarded-for': ip },
    }),
    { params: Promise.resolve({ reference }) },
  );

describe('GET /api/orders/[reference]', () => {
  it('returns the status to the holder of the callback token, and nothing sensitive', async () => {
    const o = await fileOrder();
    const res = await get(o.reference, o.callbackToken);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'pending', reference: o.reference, totalCases: 14, totalBottles: 168 });
    expect(JSON.stringify(json)).not.toMatch(/casabella|Ana Reyes|Rizal|callback|token|total"/i);
  });

  it('reflects a settled payment', async () => {
    const o = await fileOrder();
    await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'paid');
    expect((await (await get(o.reference, o.callbackToken)).json()).status).toBe('paid');
  });

  it('answers one identical 404 for an unknown order, a missing token and a wrong token', async () => {
    const o = await fileOrder();
    const answers = await Promise.all([
      get('YZ-0123456789', o.callbackToken),
      get(o.reference),
      get(o.reference, ''),
      get(o.reference, 'x'.repeat(o.callbackToken.length)),
      get(o.reference, o.callbackToken.slice(0, -1)),
      get('../../etc/passwd', 'x'),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    }
  });

  it('rate limits a single source', async () => {
    const o = await fileOrder();
    let limited = 0;
    for (let i = 0; i < 130; i += 1) {
      if ((await get(o.reference, o.callbackToken, '10.9.9.9')).status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    // another source is unaffected
    expect((await get(o.reference, o.callbackToken, '10.8.8.8')).status).toBe(200);
  });

  it('answers 503 when the store is unavailable', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@127.0.0.1:1/db');
    const res = await get('YZ-0123456789', 'x', '10.7.7.7');
    expect(res.status).toBe(503);
  });
});
