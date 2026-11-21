import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileOrder, setupStore, teardownStore } from '@/test/payment-helpers';
import { setPaymentId } from '@/lib/server/orders';
import { PaymentApiError } from '@/lib/payments/types';

const reconcileOrder = vi.fn();
vi.mock('@/lib/server/paymentReconcile', () => ({ reconcileOrder: (...args: unknown[]) => reconcileOrder(...args) }));

import { GET, POST } from './route';

const SECRET = 'w'.repeat(32);

beforeEach(() => {
  setupStore();
  vi.stubEnv('HEXACORP_WEBHOOK_SECRET', SECRET);
  reconcileOrder.mockReset();
  reconcileOrder.mockResolvedValue({ changed: true });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  teardownStore();
  vi.restoreAllMocks();
});

function post(body: unknown, k: string | null = SECRET, raw = false) {
  const url = `http://localhost/api/webhooks/hexacorp${k === null ? '' : `?k=${encodeURIComponent(k)}`}`;
  return POST(new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) }));
}

describe('GET /api/webhooks/hexacorp', () => {
  it('answers a bare liveness ping (Hexacorp probes the callback URL when a payment is created)', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('POST /api/webhooks/hexacorp: authentication', () => {
  it('refuses a missing, wrong or near-miss URL secret with 401 and reconciles nothing', async () => {
    const o = await fileOrder();
    for (const k of [null, '', 'wrong', SECRET.slice(0, -1), SECRET + 'x']) {
      const res = await post({ txn_ref: o.reference }, k);
      expect(res.status).toBe(401);
    }
    expect(reconcileOrder).not.toHaveBeenCalled();
  });

  it('answers 500 when the server has no webhook secret, never accepting an unauthenticated delivery', async () => {
    vi.stubEnv('HEXACORP_WEBHOOK_SECRET', '');
    const o = await fileOrder();
    expect((await post({ txn_ref: o.reference }, '')).status).toBe(500);
    expect(reconcileOrder).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/hexacorp: payload', () => {
  it('rejects invalid JSON, a non-object and a body with no reference', async () => {
    expect((await post('{nope', SECRET, true)).status).toBe(400);
    expect((await post('[1]', SECRET, true)).status).toBe(400);
    expect((await post('"x"', SECRET, true)).status).toBe(400);
    expect((await post({ status: 'success', amount: '1.00' })).status).toBe(400);
    expect(reconcileOrder).not.toHaveBeenCalled();
  });

  it('answers an unknown order with the same 401 as an unauthorised one', async () => {
    expect((await post({ txn_ref: 'YZ-0123456789' })).status).toBe(401);
    expect((await post({ txn_ref: '../../x' })).status).toBe(401);
    expect((await post({ reference_number: 'HX-NOPE' })).status).toBe(401);
    expect(reconcileOrder).not.toHaveBeenCalled();
  });

  it('refuses an order that is not on this gateway', async () => {
    const o = await fileOrder({ paymentProvider: null });
    expect((await post({ txn_ref: o.reference })).status).toBe(401);
    expect(reconcileOrder).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/hexacorp: reconciling', () => {
  it('finds the order by txn_ref and reconciles the ROW it read, not the delivery', async () => {
    const o = await fileOrder();
    await setPaymentId(o.reference, 'HX-STORED');
    const res = await post({ txn_ref: o.reference, reference_number: 'HX-FORGED', status: 'success', amount: '141132.00' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(reconcileOrder).toHaveBeenCalledTimes(1);
    const passed = reconcileOrder.mock.calls[0][0];
    expect(passed.reference).toBe(o.reference);
    expect(passed.paymentId).toBe('HX-STORED'); // from the row, never the forged delivered value
  });

  it('falls back to Hexacorp\'s reference_number when there is no txn_ref', async () => {
    const o = await fileOrder();
    await setPaymentId(o.reference, 'HX-100');
    expect((await post({ reference_number: 'HX-100' })).status).toBe(200);
    expect(reconcileOrder.mock.calls[0][0].reference).toBe(o.reference);
  });

  it('never reads the delivered status or amount: they cannot influence what is reconciled', async () => {
    const o = await fileOrder();
    await post({ txn_ref: o.reference, status: 'success', amount: '0.01' });
    expect(reconcileOrder).toHaveBeenCalledWith(expect.objectContaining({ reference: o.reference }));
    expect(reconcileOrder.mock.calls[0]).toHaveLength(1);
  });

  it('acks 200 even when reconcile throws, because a retry cannot fix our own failure', async () => {
    const o = await fileOrder();
    reconcileOrder.mockRejectedValue(new Error('hexacorp down'));
    const res = await post({ txn_ref: o.reference });
    expect(res.status).toBe(200);
  });

  it('logs a failed reconcile by name, message and status only: never the raw gateway response body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const o = await fileOrder();
    reconcileOrder.mockRejectedValue(new PaymentApiError('Hexacorp GET inquiry failed (500)', 500, { echoed: 'SECRET-BODY-0123', callback_url: 'https://x.example/?k=' + SECRET }, 'HX-1'));
    await post({ txn_ref: o.reference });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('inquiry failed (500)');
    expect(logged).not.toContain('SECRET-BODY');
    expect(logged).not.toContain(SECRET);
  });

  it('acks 200 when the store itself is unavailable, leaving the sweeper to recover it', async () => {
    // A database that cannot be reached (nothing listens on port 1): every read throws.
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@127.0.0.1:1/db');
    const res = await post({ txn_ref: 'YZ-0123456789' });
    expect(res.status).toBe(200);
    expect(reconcileOrder).not.toHaveBeenCalled();
  });
});
