import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAGRANCES } from '@/lib/catalog/data';
import { UNIT_PRICE } from '@/lib/pricing';

let POST: (req: Request) => Promise<Response>;
let dir: string;

const sig = FRAGRANCES.find((f) => f.tier === 'signature' && f.inStock && f.volumes.includes('50ml'))!;
const oos = FRAGRANCES.find((f) => !f.inStock)!;

beforeAll(async () => {
  process.env.CHECKOUT_RATE_LIMIT_PER_MIN = '1000';
  process.env.CHECKOUT_IP_ORDERS_PER_10MIN = '1000';
  process.env.CHECKOUT_ORDERS_PER_10MIN = '1000';
  POST = (await import('./route')).POST;
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yz-orders-'));
  vi.stubEnv('LOCAL_STORE_DIR', dir);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('CHECKOUT_TEST_ITEM', '');
  // INVOICE mode: no gateway. The card flow has its own file (route.card.test.ts).
  vi.stubEnv('PAYMENT_PROVIDERS', '');
});

// Per test, not per file: a NODE_ENV=production stub must not leak into the next test, where it
// (correctly) disables the local file store.
afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function body(over: Record<string, unknown> = {}) {
  return {
    buyer: { company: 'Casa Bella', contactName: 'Ana Reyes', email: 'ana@casabella.example', phone: '+63 917 000 0000' },
    shipping: { line1: '1 Rizal St', city: 'Cebu City', postalCode: '6000', country: 'Philippines' },
    items: [{ fragranceId: sig.id, volumeId: '50ml', cases: 3 }],
    ...over,
  };
}

const call = (b: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST(new Request('http://localhost/api/checkout', { method: 'POST', headers, body: typeof b === 'string' ? b : JSON.stringify(b) }));

const saved = () => {
  const folder = path.join(dir, 'orders');
  return existsSync(folder) ? readdirSync(folder).map((name) => JSON.parse(readFileSync(path.join(folder, name), 'utf8'))) : [];
};

describe('POST /api/checkout', () => {
  it('places an order with no link at all and files it pending, priced by the server', async () => {
    const res = await call(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reference).toMatch(/^YZ-[0-9A-F]{10}$/);
    expect(json.totalBottles).toBe(36);
    expect(json.subtotal).toBe(36 * UNIT_PRICE.signature['50ml']);
    const [order] = saved();
    expect(order.reference).toBe(json.reference);
    expect(order.linkId).toBe('public');
    expect(order.lines[0].unitPrice).toBe(UNIT_PRICE.signature['50ml']);
    expect(order).not.toHaveProperty('status', 'paid');
    // No gateway is involved in invoice mode.
    expect(json.mode).toBe('invoice');
    expect(json).not.toHaveProperty('redirectUrl');
    expect(json).not.toHaveProperty('token');
    expect(order.paymentProvider).toBeNull();
    expect(order.status).toBe('pending');
  });

  it('never calls a payment gateway in invoice mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await call(body());
    vi.unstubAllGlobals();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is OPEN: there is no order link to present, and a leftover link field in the body is simply ignored', async () => {
    for (const extra of [{}, { link: 'anything' }, { link: 'v1.e30.AAAA' }]) {
      const res = await call(body(extra));
      expect(res.status, JSON.stringify(extra)).toBe(200);
    }
    expect(saved()).toHaveLength(3);
  });

  it('does not depend on any signing secret or revocation list', async () => {
    vi.stubEnv('CHECKOUT_LINK_SECRET', '');
    vi.stubEnv('CHECKOUT_REVOKED_LINK_IDS', 'public');
    expect((await call(body())).status).toBe(200);
  });

  it('ignores any price in the request body', async () => {
    const res = await call(body({
      items: [{ fragranceId: sig.id, volumeId: '50ml', cases: 3, unitPrice: 1, price: 1, lineTotal: 1 }],
      total: 1,
      subtotal: 1,
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(36 * UNIT_PRICE.signature['50ml']);
  });

  it('refuses an order below the minimum with the amounts in the message', async () => {
    const res = await call(body({ items: [{ fragranceId: sig.id, volumeId: '10ml', cases: 1 }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/minimum order/i);
    expect(saved()).toHaveLength(0);
  });

  it('refuses an out-of-stock fragrance and an unknown volume', async () => {
    const a = await call(body({ items: [{ fragranceId: oos.id, volumeId: oos.volumes[0], cases: 5 }] }));
    expect(a.status).toBe(400);
    const b = await call(body({ items: [{ fragranceId: sig.id, volumeId: '5ml', cases: 5 }] }));
    expect(b.status).toBe(400);
  });

  it('rejects wrong content type, bad JSON, a filled honeypot and an oversized body', async () => {
    expect((await call(body(), { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await call('{not json')).status).toBe(400);
    expect((await call(body({ website: 'bot' }))).status).toBe(400);
    expect((await call(body({ notes: 'x'.repeat(70_000) }))).status).toBe(413);
  });

  it('answers 503 and says nothing was sent when no store is configured', async () => {
    vi.stubEnv('LOCAL_STORE_DIR', '');
    const res = await call(body());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/nothing has been sent/i);
  });

  it('does not write contact details to the log', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await call(body());
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toMatch(/casabella|Ana Reyes|Rizal|917/i);
    info.mockRestore();
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
});
