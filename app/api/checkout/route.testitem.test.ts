// TEST MODE (CHECKOUT_TEST_ITEM=1): the only thing the checkout offers is a PHP 10 test item, so a LIVE
// payment can be proven end to end for ten pesos. `fetch` is stubbed: nothing here reaches Hexacorp.

import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAGRANCES } from '@/lib/catalog/data';

let POST: (req: Request) => Promise<Response>;
let dir: string;
const real = FRAGRANCES.find((f) => f.tier === 'signature' && f.inStock && f.volumes.includes('50ml'))!;

beforeAll(async () => {
  process.env.CHECKOUT_RATE_LIMIT_PER_MIN = '1000';
  process.env.CHECKOUT_IP_ORDERS_PER_10MIN = '1000';
  process.env.CHECKOUT_ORDERS_PER_10MIN = '1000';
  POST = (await import('./route')).POST;
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yz-testitem-'));
  vi.stubEnv('LOCAL_STORE_DIR', dir);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('PAYMENT_PROVIDERS', '');
  vi.stubEnv('CHECKOUT_TEST_ITEM', '1');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const body = (items: unknown[]) => ({
  buyer: { company: 'Casa Bella', contactName: 'Ana Maria Reyes', email: 'ana@casabella.example', phone: '09171234567' },
  shipping: { line1: '1 Rizal St', city: 'Cebu City', postalCode: '6000', country: 'Philippines' },
  items,
});

const TEST_LINE = { fragranceId: 'yz-test', volumeId: '10ml', cases: 1 };

const call = (b: unknown) =>
  POST(new Request('http://localhost/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }));

const saved = () => {
  const folder = path.join(dir, 'orders');
  return existsSync(folder) ? readdirSync(folder).map((n) => JSON.parse(readFileSync(path.join(folder, n), 'utf8'))) : [];
};

describe('test mode: invoice mode', () => {
  it('takes a single PHP 10 test item, with the minimum lowered to match', async () => {
    const res = await call(body([TEST_LINE]));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ mode: 'invoice', totalCases: 1, totalBottles: 1, subtotal: 10, discount: 0, total: 10 });
    const [order] = saved();
    expect(order.lines[0]).toMatchObject({ fragranceId: 'yz-test', fragranceName: 'Test item', unitPrice: 10, lineTotal: 10, casePack: 1 });
    expect(order.totals.total).toBe(10);
  });

  it('scales with quantity at PHP 10 each, and never gets a volume discount', async () => {
    const json = await (await call(body([{ ...TEST_LINE, cases: 3 }]))).json();
    expect(json).toMatchObject({ totalBottles: 3, total: 30, discountPercent: 0 });
    const many = await (await call(body([{ ...TEST_LINE, cases: 70 }]))).json(); // would be 15% off for real stock
    expect(many).toMatchObject({ total: 700, discount: 0, discountPercent: 0 });
  });

  it('REFUSES anything but the test item, so no real stock can be bought while testing', async () => {
    const res = await call(body([{ fragranceId: real.id, volumeId: '50ml', cases: 5 }]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only the test item/i);
    expect(saved()).toHaveLength(0);
  });

  it('refuses a real fragrance mixed in with the test item', async () => {
    expect((await call(body([TEST_LINE, { fragranceId: real.id, volumeId: '50ml', cases: 5 }]))).status).toBe(400);
    expect(saved()).toHaveLength(0);
  });

  it('refuses the test item with another volume, and ignores any price the caller sends', async () => {
    expect((await call(body([{ ...TEST_LINE, volumeId: '50ml' }]))).status).toBe(400);
    const json = await (await call(body([{ ...TEST_LINE, unitPrice: 1, price: 1, lineTotal: 1 }]))).json();
    expect(json.total).toBe(10);
  });
});

describe('outside test mode the test item does not exist', () => {
  it('rejects the test item when CHECKOUT_TEST_ITEM is not set, and the real minimum is back', async () => {
    vi.stubEnv('CHECKOUT_TEST_ITEM', '');
    const res = await call(body([TEST_LINE]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no longer listed/i);
    expect(saved()).toHaveLength(0);
    // a small real order is refused by the real minimum again
    const small = await call(body([{ fragranceId: real.id, volumeId: '10ml', cases: 1 }]));
    expect((await small.json()).error).toMatch(/minimum order/i);
  });

  it('only the exact value "1" turns it on', async () => {
    for (const v of ['true', 'yes', '0', '11', 'on']) {
      vi.stubEnv('CHECKOUT_TEST_ITEM', v);
      expect((await call(body([TEST_LINE]))).status, v).toBe(400);
    }
  });
});

describe('test mode: card mode (Hexacorp live, fetch stubbed)', () => {
  beforeEach(() => {
    vi.stubEnv('PAYMENT_PROVIDERS', 'hexacorp');
    vi.stubEnv('HEXACORP_APP_UUID', 'app-uuid');
    vi.stubEnv('HEXACORP_USERNAME', 'merchant-user');
    vi.stubEnv('HEXACORP_SECRET', 'merchant-secret-value');
    vi.stubEnv('HEXACORP_WEBHOOK_SECRET', 'w'.repeat(32));
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.example');
  });

  it('charges exactly PHP 10.00 and sends the buyer to the hosted page', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { reference_number: 'HX-TEST', payment_url: 'https://pay.hexacorp.xyz/checkout/HX-TEST' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await call(body([TEST_LINE]));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ mode: 'card', total: 10, redirectUrl: 'https://pay.hexacorp.xyz/checkout/HX-TEST' });

    const sent = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(sent.merchant_details.txn_amount).toBe('10.00'); // a decimal-peso STRING, never centavos
    const [order] = saved();
    expect(order).toMatchObject({ status: 'pending', paymentProvider: 'hexacorp', paymentId: 'HX-TEST' });
  });

  it('does not reach Hexacorp at all for a refused real-stock order', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await call(body([{ fragranceId: real.id, volumeId: '50ml', cases: 5 }]))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
