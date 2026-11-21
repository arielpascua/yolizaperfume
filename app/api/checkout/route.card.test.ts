// Card mode: PAYMENT_PROVIDERS=hexacorp. `fetch` is stubbed throughout: this suite NEVER reaches the
// live Hexacorp API (there is no sandbox, so a real call would be a real charge).

import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAGRANCES } from '@/lib/catalog/data';

const WEBHOOK_SECRET = 'w'.repeat(32);
let POST: (req: Request) => Promise<Response>;
let dir: string;

const sig = FRAGRANCES.find((f) => f.tier === 'signature' && f.inStock && f.volumes.includes('50ml'))!;
// 3 cases x 12 bottles x PHP 880 = PHP 31,680, no discount.
const EXPECTED_TOTAL = '31680.00';

beforeAll(async () => {
  process.env.CHECKOUT_RATE_LIMIT_PER_MIN = '1000';
  process.env.CHECKOUT_IP_ORDERS_PER_10MIN = '1000';
  process.env.CHECKOUT_ORDERS_PER_10MIN = '1000';
  POST = (await import('./route')).POST;
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yz-card-'));
  vi.stubEnv('LOCAL_STORE_DIR', dir);
  vi.stubEnv('CHECKOUT_TEST_ITEM', '');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('PAYMENT_PROVIDERS', 'hexacorp');
  vi.stubEnv('HEXACORP_APP_UUID', 'app-uuid');
  vi.stubEnv('HEXACORP_USERNAME', 'merchant-user');
  vi.stubEnv('HEXACORP_SECRET', 'merchant-secret-value');
  vi.stubEnv('HEXACORP_WEBHOOK_SECRET', WEBHOOK_SECRET);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.example');
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

const AUTH = { status: 200, body: { data: { token: 'tok-1' } } };
const CREATED = {
  status: 200,
  body: { status: 'success', data: { txn_ref: 'x', reference_number: 'HX-100', payment_url: 'https://pay.hexacorp.xyz/checkout/HX-100' } },
};

function stubFetch(...responses: { status: number; body: unknown }[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(r.body), { status: r.status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function body(over: Record<string, unknown> = {}) {
  return {
    buyer: { company: 'Casa Bella', contactName: 'Ana Maria Reyes', email: 'ana@casabella.example', phone: '+63 917 000 0000' },
    shipping: { line1: '1 Rizal St', city: 'Cebu City', postalCode: '6000', country: 'Philippines' },
    items: [{ fragranceId: sig.id, volumeId: '50ml', cases: 3 }],
    ...over,
  };
}

const call = (b: unknown) =>
  POST(new Request('http://localhost/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }));

const saved = () => {
  const folder = path.join(dir, 'orders');
  return existsSync(folder) ? readdirSync(folder).map((n) => JSON.parse(readFileSync(path.join(folder, n), 'utf8'))) : [];
};

describe('POST /api/checkout in card mode', () => {
  it('files the order pending, creates the payment and hands back the hosted page and a poll token', async () => {
    const fetchMock = stubFetch(AUTH, CREATED);
    const res = await call(body());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toMatchObject({ mode: 'card', redirectUrl: 'https://pay.hexacorp.xyz/checkout/HX-100', totalBottles: 36, total: 31680 });
    expect(json.token.length).toBeGreaterThanOrEqual(32);
    expect(json.reference).toMatch(/^YZ-[0-9A-F]{10}$/);

    const [order] = saved();
    expect(order).toMatchObject({ reference: json.reference, status: 'pending', paymentProvider: 'hexacorp', paymentId: 'HX-100', callbackToken: json.token });
    // The browser's answer is never what marks an order paid.
    expect(order.status).not.toBe('paid');
    expect(json).not.toHaveProperty('status');

    // What was sent to Hexacorp: live host, our reference, a STRING amount in pesos, a normalised mobile.
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.payment.hexacorp.xyz/api/v1/auth/obtain-token/');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.payment.hexacorp.xyz/api/v1/payments/credit-card/');
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(sent.txn_ref).toBe(json.reference);
    expect(sent.merchant_details).toMatchObject({
      txn_amount: EXPECTED_TOTAL,
      first_name: 'Ana',
      last_name: 'Maria Reyes',
      email: 'ana@casabella.example',
      mobile_number: '639170000000',
    });
    expect(sent.callback_url).toBe(`https://shop.example/api/webhooks/hexacorp?k=${WEBHOOK_SECRET}`);
  });

  it('prices the charge on the server: a price in the request body changes nothing', async () => {
    const fetchMock = stubFetch(AUTH, CREATED);
    await call(body({ items: [{ fragranceId: sig.id, volumeId: '50ml', cases: 3, unitPrice: 1, price: 1 }], total: 1, amount: 1 }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).merchant_details.txn_amount).toBe(EXPECTED_TOTAL);
  });

  it('builds the callback from NEXT_PUBLIC_SITE_URL, never from the request Host', async () => {
    const fetchMock = stubFetch(AUTH, CREATED);
    await POST(
      new Request('http://evil.example/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'evil.example' },
        body: JSON.stringify(body()),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).callback_url).toMatch(/^https:\/\/shop\.example\/api\/webhooks\/hexacorp\?k=/);
  });

  it('answers 503 and files NOTHING when a gateway is listed but its credentials are missing: it never falls back to invoice mode', async () => {
    vi.stubEnv('HEXACORP_SECRET', '');
    const fetchMock = stubFetch();
    const res = await call(body());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/nothing has been charged/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
  });

  it('answers 503 and files nothing in production without NEXT_PUBLIC_SITE_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    const fetchMock = stubFetch();
    expect((await call(body())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
  });

  it('refuses a phone Hexacorp would reject before filing anything or calling the gateway', async () => {
    const fetchMock = stubFetch();
    const res = await call(body({ buyer: { company: 'Casa Bella', contactName: 'Ana Reyes', email: 'ana@casabella.example', phone: '+1 415 555 0100' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Philippine mobile/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
  });

  it('does not call the gateway for a bad body or an order under the minimum', async () => {
    const fetchMock = stubFetch();
    expect((await call(body({ items: [] }))).status).toBe(400);
    expect((await call(body({ items: [{ fragranceId: sig.id, volumeId: '10ml', cases: 1 }] }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
  });

  it('does not call the gateway when the order cannot be saved', async () => {
    vi.stubEnv('LOCAL_STORE_DIR', '');
    const fetchMock = stubFetch(AUTH, CREATED);
    expect((await call(body())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the order failed and answers 502 when Hexacorp rejects the payment', async () => {
    stubFetch(AUTH, { status: 400, body: { message: 'Validation Failed!', errors: [{ callback_url: 'Callback URL is not reachable.' }] } });
    const res = await call(body());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/nothing has been charged/i);
    const [order] = saved();
    expect(order.status).toBe('failed');
  });

  it('leaves the order PENDING (not failed) when the create itself did not complete: Hexacorp may hold a transaction', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 }));
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call(body());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('redirectUrl');
    const [order] = saved();
    // Pending with no reference: the sweeper reports it as UNREFERENCED, the scheduled run goes red,
    // and a person checks Hexacorp for this txn_ref. A failed order with no reference would be skipped.
    expect(order).toMatchObject({ status: 'pending', paymentId: null });
  });

  it('marks the order failed when authentication with Hexacorp fails', async () => {
    stubFetch({ status: 401, body: { message: 'bad credentials' } });
    expect((await call(body())).status).toBe(502);
    expect(saved()[0].status).toBe('failed');
  });

  it('keeps Hexacorp\'s reference when it accepted the payment but gave the payer nowhere to go', async () => {
    stubFetch(AUTH, { status: 200, body: { status: 'success', data: { txn_ref: 'x', reference_number: 'HX-777' } } });
    const res = await call(body());
    expect(res.status).toBe(502);
    const [order] = saved();
    // Failed for now, but findable: a payment completed anyway can still be reconciled.
    expect(order).toMatchObject({ status: 'failed', paymentId: 'HX-777' });
  });

  it('never leaks a gateway error body, a credential or the webhook secret to the buyer', async () => {
    stubFetch(AUTH, { status: 500, body: { message: `internal ${WEBHOOK_SECRET} merchant-secret-value` } });
    const res = await call(body());
    const text = await res.text();
    expect(text).not.toContain(WEBHOOK_SECRET);
    expect(text).not.toContain('merchant-secret-value');
    expect(text).not.toMatch(/internal/);
  });

  it('never builds the callback from the request, even outside production: no NEXT_PUBLIC_SITE_URL means 503', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const fetchMock = stubFetch(AUTH, CREATED);
    expect((await call(body())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
  });

  it.each([
    'http://pay.hexacorp.xyz/checkout/HX-100',
    'https://pay.hexacorp.xyz.evil.example/x',
    'https://evil.example/pay',
    'javascript:alert(1)',
  ])('REFUSES to hand the buyer %s, failing the order and keeping the reference for recovery', async (payment_url) => {
    stubFetch(AUTH, { status: 200, body: { data: { reference_number: 'HX-100', payment_url } } });
    const res = await call(body());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('redirectUrl');
    expect(text).not.toContain('evil.example');
    const [order] = saved();
    expect(order).toMatchObject({ status: 'failed', paymentId: 'HX-100' });
  });

  it('fails the order and sends the buyer nowhere when Hexacorp returns a payer URL but no reference_number', async () => {
    stubFetch(AUTH, { status: 200, body: { data: { id: 99, payment_url: 'https://pay.hexacorp.xyz/checkout/99' } } });
    const res = await call(body());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('redirectUrl');
    const [order] = saved();
    expect(order.status).toBe('failed');
    expect(order.paymentId).toBeNull();
  });

  it('does not write contact details or the payment URL to the log', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    stubFetch(AUTH, { status: 200, body: { data: { reference_number: 'HX-100', payment_url: 'https://pay.hexacorp.xyz/checkout/HX-100?t=SECRETTOKEN' } } });
    await call(body());
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toMatch(/casabella|Ana Maria|Rizal|SECRETTOKEN|917/i);
    expect(logged).toContain('pay.hexacorp.xyz'); // the host alone is logged, to diagnose a refused redirect
  });
});
