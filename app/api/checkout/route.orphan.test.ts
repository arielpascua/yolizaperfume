// The reviewed orphaned-payment case: Hexacorp accepts the payment, but WE cannot store its
// reference_number. The buyer must not be sent to pay (the payment could never be matched to the
// order), the order must be failed, and the reference must be logged so a person can recover it.

import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAGRANCES } from '@/lib/catalog/data';

vi.mock('@/lib/server/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/orders')>();
  const { StoreUnavailableError } = await import('@/lib/server/store');
  // A plain function, not vi.fn(): restoreAllMocks() would wipe a vi.fn() rejection after the first test.
  return {
    ...actual,
    setPaymentId: async () => {
      throw new StoreUnavailableError('write failed');
    },
  };
});

let POST: (req: Request) => Promise<Response>;
let dir: string;
const sig = FRAGRANCES.find((f) => f.tier === 'signature' && f.inStock && f.volumes.includes('50ml'))!;

beforeAll(async () => {
  process.env.CHECKOUT_RATE_LIMIT_PER_MIN = '1000';
  process.env.CHECKOUT_IP_ORDERS_PER_10MIN = '1000';
  process.env.CHECKOUT_ORDERS_PER_10MIN = '1000';
  POST = (await import('./route')).POST;
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yz-orphan-'));
  vi.stubEnv('LOCAL_STORE_DIR', dir);
  vi.stubEnv('CHECKOUT_TEST_ITEM', '');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('PAYMENT_PROVIDERS', 'hexacorp');
  vi.stubEnv('HEXACORP_APP_UUID', 'app-uuid');
  vi.stubEnv('HEXACORP_USERNAME', 'merchant-user');
  vi.stubEnv('HEXACORP_SECRET', 'merchant-secret-value');
  vi.stubEnv('HEXACORP_WEBHOOK_SECRET', 'w'.repeat(32));
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.example');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function stubHexacorp() {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 }));
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ data: { reference_number: 'HX-ORPHAN', payment_url: 'https://pay.hexacorp.xyz/checkout/HX-ORPHAN' } }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
}

const call = () =>
  POST(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        buyer: { company: 'Casa Bella', contactName: 'Ana Reyes', email: 'ana@casabella.example', phone: '0917 123 4567' },
        shipping: { line1: '1 Rizal St', city: 'Cebu City', postalCode: '6000', country: 'Philippines' },
        items: [{ fragranceId: sig.id, volumeId: '50ml', cases: 3 }],
      }),
    }),
  );

describe('POST /api/checkout: Hexacorp accepted the payment but its reference could not be stored', () => {
  it('does NOT send the buyer to pay, fails the order and answers 502', async () => {
    stubHexacorp();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('redirectUrl');
    expect(text).not.toContain('hexacorp.xyz');
    expect(text).not.toContain('HX-ORPHAN');
    expect(text).toMatch(/nothing has been charged/i);

    const folder = path.join(dir, 'orders');
    const orders = existsSync(folder) ? readdirSync(folder).map((n) => JSON.parse(readFileSync(path.join(folder, n), 'utf8'))) : [];
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('failed');
  });

  it('logs Hexacorp\'s reference loudly so a person can match the orphaned transaction by hand', async () => {
    stubHexacorp();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await call();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('ORPHANED PAYMENT RISK');
    expect(logged).toContain('HX-ORPHAN');
    // ...and still nothing sensitive.
    expect(logged).not.toMatch(/casabella|Ana Reyes|Rizal|merchant-secret-value/i);
  });
});
