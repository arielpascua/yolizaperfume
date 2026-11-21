import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileOrder, setupStore, teardownStore } from '@/test/payment-helpers';
import { markOrderFailed, setPaymentId } from '@/lib/server/orders';

const reconcileOrder = vi.fn();
vi.mock('@/lib/server/paymentReconcile', () => ({
  reconcileOrder: (...args: unknown[]) => reconcileOrder(...args),
  needsAttention: (o: Record<string, unknown>) => Boolean(o.blockedByAmountMismatch || o.blockedByReferenceMismatch || o.unreferenced || o.unresolved),
}));

import { POST } from './route';

const SECRET = 'r'.repeat(32);

beforeEach(() => {
  setupStore();
  vi.stubEnv('RECONCILE_SECRET', SECRET);
  reconcileOrder.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  teardownStore();
  vi.restoreAllMocks();
});

const call = (query = '', auth: string | null = `Bearer ${SECRET}`) =>
  POST(new NextRequest(`http://localhost/api/admin/orders/reconcile${query}`, { method: 'POST', headers: auth === null ? {} : { authorization: auth } }));

/** Orders are only swept once older than two minutes: age them by faking the clock forward. */
function minutesFromNow(m: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + m * 60_000);
}

describe('POST /api/admin/orders/reconcile: auth', () => {
  it('refuses a missing, malformed or wrong bearer', async () => {
    for (const auth of [null, '', 'Bearer', 'Bearer wrong', `Basic ${SECRET}`, SECRET, `Bearer ${SECRET}x`]) {
      expect((await call('', auth)).status).toBe(403);
    }
    expect(reconcileOrder).not.toHaveBeenCalled();
  });

  it('refuses EVERYONE when RECONCILE_SECRET is unset, never opening access', async () => {
    vi.stubEnv('RECONCILE_SECRET', '');
    expect((await call('', 'Bearer ')).status).toBe(403);
    expect((await call('', `Bearer ${SECRET}`)).status).toBe(403);
  });
});

describe('POST /api/admin/orders/reconcile: sweeping', () => {
  it('reconciles each stale unpaid card order and reports the outcome', async () => {
    const a = await fileOrder();
    const b = await fileOrder();
    await fileOrder({ paymentProvider: null }); // invoice-mode order: not this sweeper's business
    reconcileOrder.mockImplementation(async (o: { reference: string }) => ({ reference: o.reference, from: 'pending', to: 'paid', changed: true }));
    minutesFromNow(10);
    const res = await call();
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ swept: 2, changed: 2, attention: 0, errors: [] });
    expect(reconcileOrder.mock.calls.map((c) => c[0].reference).sort()).toEqual([a.reference, b.reference].sort());
  });

  it('leaves a very recent order alone so the sweep does not race the webhook', async () => {
    await fileOrder();
    const res = await call();
    expect((await res.json()).swept).toBe(0);
    expect(reconcileOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['a refused amount', { blockedByAmountMismatch: true }],
    ['a payment belonging to another order', { blockedByReferenceMismatch: true }],
    ['a card order with no stored reference', { unreferenced: true }],
    ['a status Hexacorp reported that cannot be mapped', { unresolved: true }],
  ])('counts %s as needing attention so the scheduled job fails loudly', async (_label, flag) => {
    await fileOrder();
    reconcileOrder.mockResolvedValue({ reference: 'x', from: 'pending', to: 'pending', changed: false, ...flag });
    minutesFromNow(10);
    const json = await (await call()).json();
    vi.useRealTimers();
    expect(json).toMatchObject({ swept: 1, changed: 0, attention: 1 });
  });

  it('does NOT count an ordinary no-op as needing attention', async () => {
    await fileOrder();
    reconcileOrder.mockResolvedValue({ reference: 'x', from: 'pending', to: 'pending', changed: false });
    minutesFromNow(10);
    const json = await (await call()).json();
    vi.useRealTimers();
    expect(json).toMatchObject({ swept: 1, attention: 0 });
  });

  it('also sweeps a recently FAILED order that holds a Hexacorp reference: failed is not final', async () => {
    const withRef = await fileOrder();
    await setPaymentId(withRef.reference, 'HX-100');
    await markOrderFailed(withRef.reference);
    const neverReached = await fileOrder();
    await markOrderFailed(neverReached.reference); // create was rejected: nothing exists at Hexacorp
    reconcileOrder.mockResolvedValue({ reference: 'x', from: 'failed', to: 'paid', changed: true });
    minutesFromNow(10);
    const json = await (await call()).json();
    vi.useRealTimers();
    expect(json.swept).toBe(1);
    expect(reconcileOrder).toHaveBeenCalledWith(expect.objectContaining({ reference: withRef.reference, status: 'failed' }));
  });

  it('records a failing order and carries on with the rest', async () => {
    await fileOrder();
    await fileOrder();
    reconcileOrder.mockRejectedValueOnce(new Error('hexacorp 500')).mockResolvedValueOnce({ reference: 'y', from: 'pending', to: 'paid', changed: true });
    minutesFromNow(10);
    const json = await (await call()).json();
    vi.useRealTimers();
    expect(json.swept).toBe(2);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0].message).toBe('hexacorp 500');
    expect(json.changed).toBe(1);
  });

  it('cannot be starved: a pile of abandoned pending orders never crowds out a failed order, and the sweep says it was truncated', async () => {
    for (let i = 0; i < 45; i += 1) await fileOrder(); // abandoned checkouts, all older than the failed one
    const failed = await fileOrder();
    await setPaymentId(failed.reference, 'HX-RETRY');
    await markOrderFailed(failed.reference);
    reconcileOrder.mockResolvedValue({ reference: 'x', from: 'pending', to: 'pending', changed: false });
    minutesFromNow(10);
    const json = await (await call()).json();
    vi.useRealTimers();
    expect(json.truncated).toBe(true); // 45 pending against a budget of 40
    expect(json.swept).toBe(41); // 40 pending + the failed one
    expect(reconcileOrder.mock.calls.map((c) => c[0].reference)).toContain(failed.reference);
  });

  it('is round-robin across sweeps: the pending orders left out of one sweep are first in the next', async () => {
    const refs: string[] = [];
    for (let i = 0; i < 45; i += 1) refs.push((await fileOrder()).reference);
    reconcileOrder.mockResolvedValue({ reference: 'x', from: 'pending', to: 'pending', changed: false });
    minutesFromNow(10);
    await call();
    const first = new Set(reconcileOrder.mock.calls.map((c) => c[0].reference as string));
    reconcileOrder.mockClear();
    await call();
    const second = new Set(reconcileOrder.mock.calls.map((c) => c[0].reference as string));
    vi.useRealTimers();
    expect(first.size).toBe(40);
    // together the two sweeps reach every one of the 45, and the second starts with the 5 the first missed
    expect(new Set([...first, ...second]).size).toBe(45);
    for (const r of refs.filter((x) => !first.has(x))) expect(second.has(r)).toBe(true);
  });

  it('does not report truncated when nothing was left out', async () => {
    await fileOrder();
    reconcileOrder.mockResolvedValue({ reference: 'x', from: 'pending', to: 'pending', changed: false });
    minutesFromNow(10);
    expect((await (await call()).json()).truncated).toBe(false);
    vi.useRealTimers();
  });

  it('refuses a short RECONCILE_SECRET: a guessable bearer is as bad as none', async () => {
    vi.stubEnv('RECONCILE_SECRET', 'short');
    expect((await call('', 'Bearer short')).status).toBe(403);
  });

  it('reconciles a single order on demand, skipping the age window', async () => {
    const o = await fileOrder();
    reconcileOrder.mockResolvedValue({ reference: o.reference, from: 'pending', to: 'paid', changed: true });
    const json = await (await call(`?ref=${o.reference}`)).json();
    expect(json.swept).toBe(1);
    await markOrderFailed(o.reference);
    expect((await (await call(`?ref=${o.reference}`)).json()).swept).toBe(1); // a failed order can be recovered by hand too
    expect(reconcileOrder).toHaveBeenCalledWith(expect.objectContaining({ reference: o.reference }));
  });

  it('rejects a malformed ref and ignores an order that is not an unpaid card order', async () => {
    expect((await call('?ref=../../x')).status).toBe(400);
    const invoice = await fileOrder({ paymentProvider: null });
    expect((await (await call(`?ref=${invoice.reference}`)).json()).swept).toBe(0);
    expect((await (await call('?ref=YZ-0123456789')).json()).swept).toBe(0);
    expect(reconcileOrder).not.toHaveBeenCalled();
  });
});
