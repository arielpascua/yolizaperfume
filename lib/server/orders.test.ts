import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_REFERENCE_RE,
  applyOrderStatus,
  findOrderByPaymentId,
  findOrderByReference,
  listUnsettledByProvider,
  markOrderFailed,
  newCallbackToken,
  newOrderReference,
  paymentAmountMismatches,
  recordOrder,
  safeTokenEqual,
  setPaymentId,
  touchChecked,
  type OrderRecord,
} from './orders';
import { localDir } from './store';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yz-orders-unit-'));
  vi.stubEnv('LOCAL_STORE_DIR', dir);
  vi.stubEnv('DATABASE_URL', '');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function order(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    reference: newOrderReference(),
    linkId: 'link001',
    callbackToken: newCallbackToken(),
    paymentProvider: 'hexacorp',
    buyer: { company: 'Casa Bella', contactName: 'Ana Reyes', email: 'ana@casabella.example', phone: '09171234567', taxId: '' },
    shipping: { line1: '1 Rizal St', line2: '', city: 'Cebu City', region: '', postalCode: '6000', country: 'Philippines' },
    poNumber: '',
    notes: '',
    totals: { cases: 3, bottles: 36, subtotal: 31680, discountPercent: 0, discount: 0, total: 31680 },
    lines: [],
    ...over,
  };
}

describe('references and tokens', () => {
  it('generates well-formed, distinct references and tokens', () => {
    const a = newOrderReference();
    expect(a).toMatch(ORDER_REFERENCE_RE);
    expect(newOrderReference()).not.toBe(a);
    expect(newCallbackToken().length).toBeGreaterThanOrEqual(32);
    expect(newCallbackToken()).not.toBe(newCallbackToken());
  });

  it('compares tokens in constant time, with a length check first', () => {
    expect(safeTokenEqual('abc', 'abc')).toBe(true);
    expect(safeTokenEqual('abc', 'abd')).toBe(false);
    expect(safeTokenEqual('abc', 'abcd')).toBe(false);
    expect(safeTokenEqual('abc', '')).toBe(false);
  });
});

describe('paymentAmountMismatches', () => {
  it('compares in centavos so 1200 and 1200.00 agree', () => {
    expect(paymentAmountMismatches(1200, 1200)).toBe(false);
    expect(paymentAmountMismatches(1200.0, 1200)).toBe(false);
    expect(paymentAmountMismatches(141132, 141132)).toBe(false);
  });

  it('treats any difference, an absent amount or a non-finite one as a mismatch', () => {
    expect(paymentAmountMismatches(1199.99, 1200)).toBe(true);
    expect(paymentAmountMismatches(120000, 1200)).toBe(true);
    expect(paymentAmountMismatches(12, 1200)).toBe(true);
    expect(paymentAmountMismatches(null, 1200)).toBe(true);
    expect(paymentAmountMismatches(Number.NaN, 1200)).toBe(true);
    expect(paymentAmountMismatches(Number.POSITIVE_INFINITY, 1200)).toBe(true);
  });
});

describe('local order store', () => {
  it('files an order pending and reads it back without any contact detail', async () => {
    const o = order();
    await recordOrder(o);
    const found = await findOrderByReference(o.reference);
    expect(found).toMatchObject({ reference: o.reference, status: 'pending', total: 31680, totalCases: 3, totalBottles: 36, paymentProvider: 'hexacorp', paymentId: null, callbackToken: o.callbackToken });
    expect(JSON.stringify(found)).not.toMatch(/casabella|Ana Reyes|Rizal/i);
  });

  it('rejects a malformed reference before it can become part of a file path', async () => {
    for (const bad of ['../../etc/passwd', 'YZ-../x', 'yz-0123456789', 'YZ-012345678', '', 'YZ-0123456789/../x']) {
      expect(await findOrderByReference(bad)).toBeNull();
    }
    expect(existsSync(path.join(dir, '..', 'passwd'))).toBe(false);
  });

  it('stores the provider reference and finds the order by it', async () => {
    const o = order();
    await recordOrder(o);
    await setPaymentId(o.reference, 'HX-100');
    expect((await findOrderByReference(o.reference))?.paymentId).toBe('HX-100');
    expect((await findOrderByPaymentId('HX-100'))?.reference).toBe(o.reference);
    expect(await findOrderByPaymentId('HX-NOPE')).toBeNull();
    expect(await findOrderByPaymentId('')).toBeNull();
  });

  it('marks a pending order failed but never a paid one', async () => {
    const a = order();
    await recordOrder(a);
    await markOrderFailed(a.reference);
    expect((await findOrderByReference(a.reference))?.status).toBe('failed');

    const b = order();
    await recordOrder(b);
    await applyOrderStatus({ reference: b.reference, status: 'pending' }, 'paid');
    await markOrderFailed(b.reference);
    expect((await findOrderByReference(b.reference))?.status).toBe('paid');
  });
});

describe('applyOrderStatus', () => {
  it('moves pending to paid, idempotently', async () => {
    const o = order();
    await recordOrder(o);
    expect(await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'paid')).toBe('paid');
    // A replay with a stale view still ends on the truth and changes nothing.
    expect(await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'paid')).toBe('paid');
    expect((await findOrderByReference(o.reference))?.status).toBe('paid');
  });

  it('never downgrades or revisits a settled order', async () => {
    const o = order();
    await recordOrder(o);
    await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'paid');
    expect(await applyOrderStatus({ reference: o.reference, status: 'paid' }, 'failed')).toBe('paid');
    expect(await applyOrderStatus({ reference: o.reference, status: 'paid' }, 'cancelled')).toBe('paid');
    expect((await findOrderByReference(o.reference))?.status).toBe('paid');
  });

  it('lets a failed order become paid: a payer may complete a payment whose create errored', async () => {
    const o = order();
    await recordOrder(o);
    await markOrderFailed(o.reference);
    expect(await applyOrderStatus({ reference: o.reference, status: 'failed' }, 'paid')).toBe('paid');
  });

  it('does nothing for a null or unchanged status, and leaves a person-set status alone', async () => {
    const o = order();
    await recordOrder(o);
    expect(await applyOrderStatus({ reference: o.reference, status: 'pending' }, null)).toBe('pending');
    expect(await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'pending')).toBe('pending');
    expect(await applyOrderStatus({ reference: o.reference, status: 'invoiced' }, 'paid')).toBe('invoiced');
    expect(await applyOrderStatus({ reference: o.reference, status: 'shipped' }, 'failed')).toBe('shipped');
  });
});

const DAY = 86_400_000;
const WINDOW = { minAgeMs: 2 * 60 * 1000, maxAgeMs: 31 * DAY, failedMaxAgeMs: 2 * DAY, pendingLimit: 50, failedLimit: 50 };
const refs = (sweep: { orders: { reference: string }[] }) => sweep.orders.map((o) => o.reference);

describe('listUnsettledByProvider', () => {
  it('lists unpaid orders on that provider inside the age window, and no others', async () => {
    const mine = order();
    const other = order({ paymentProvider: null });
    const paid = order();
    await recordOrder(mine);
    await recordOrder(other);
    await recordOrder(paid);
    await applyOrderStatus({ reference: paid.reference, status: 'pending' }, 'paid');

    const sweep = await listUnsettledByProvider('hexacorp', { ...WINDOW, now: Date.now() + 10 * 60 * 1000 });
    expect(refs(sweep)).toEqual([mine.reference]);
    expect(sweep.truncated).toBe(false);
  });

  it('INCLUDES a pending order that has no stored reference, so it is reported rather than skipped in silence', async () => {
    const o = order();
    await recordOrder(o);
    const sweep = await listUnsettledByProvider('hexacorp', { ...WINDOW, now: Date.now() + 10 * 60 * 1000 });
    expect(sweep.orders[0]).toMatchObject({ reference: o.reference, paymentId: null });
  });

  it('INCLUDES a recently failed order that has a Hexacorp reference: failed is not final', async () => {
    const o = order();
    await recordOrder(o);
    await setPaymentId(o.reference, 'HX-100');
    await markOrderFailed(o.reference);
    expect(refs(await listUnsettledByProvider('hexacorp', { ...WINDOW, now: Date.now() + 10 * 60 * 1000 }))).toEqual([o.reference]);
  });

  it('skips a failed order with NO reference (it never reached Hexacorp) and an old failed order', async () => {
    const never = order();
    await recordOrder(never);
    await markOrderFailed(never.reference);
    const old = order();
    await recordOrder(old);
    await setPaymentId(old.reference, 'HX-OLD');
    await markOrderFailed(old.reference);

    expect(refs(await listUnsettledByProvider('hexacorp', { ...WINDOW, now: Date.now() + 10 * 60 * 1000 }))).toEqual([old.reference]);
    expect((await listUnsettledByProvider('hexacorp', { ...WINDOW, now: Date.now() + 3 * DAY })).orders).toEqual([]);
  });

  it('skips an order younger than the minimum age or older than the window', async () => {
    await recordOrder(order());
    expect((await listUnsettledByProvider('hexacorp', { ...WINDOW })).orders).toEqual([]);
    const later = Date.now() + 10 * 60 * 1000;
    expect((await listUnsettledByProvider('hexacorp', { ...WINDOW, maxAgeMs: 60_000, now: later })).orders).toEqual([]);
    expect(readdirSync(path.join(dir, 'orders'))).toHaveLength(1);
  });
});

describe('listUnsettledByProvider: the sweep cannot be starved', () => {
  const later = () => Date.now() + 10 * 60 * 1000;

  it('gives failed orders their OWN budget, so a pile of abandoned pending orders cannot crowd them out', async () => {
    for (let i = 0; i < 6; i += 1) await recordOrder(order()); // abandoned checkouts: pending, older than the failed one
    const failed = order();
    await recordOrder(failed);
    await setPaymentId(failed.reference, 'HX-RETRY');
    await markOrderFailed(failed.reference);

    const sweep = await listUnsettledByProvider('hexacorp', { ...WINDOW, pendingLimit: 2, failedLimit: 5, now: later() });
    expect(sweep.orders.filter((o) => o.status === 'pending')).toHaveLength(2);
    expect(refs(sweep)).toContain(failed.reference); // the order a charged-but-failed buyer is waiting on
    expect(sweep.truncated).toBe(true); // 6 pending, budget 2: there is more
  });

  it('is ROUND-ROBIN: orders already checked go to the back, so every order is eventually reached', async () => {
    const all: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const o = order();
      await recordOrder(o);
      all.push(o.reference);
    }
    const seen = new Set<string>();
    for (let sweep = 0; sweep < 3; sweep += 1) {
      const { orders } = await listUnsettledByProvider('hexacorp', { ...WINDOW, pendingLimit: 2, failedLimit: 5, now: later() });
      for (const o of orders) {
        seen.add(o.reference);
        await touchChecked(o.reference);
      }
    }
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it('reports truncated only when a budget was actually filled', async () => {
    for (let i = 0; i < 3; i += 1) await recordOrder(order());
    expect((await listUnsettledByProvider('hexacorp', { ...WINDOW, pendingLimit: 3, failedLimit: 5, now: later() })).truncated).toBe(false);
    expect((await listUnsettledByProvider('hexacorp', { ...WINDOW, pendingLimit: 2, failedLimit: 5, now: later() })).truncated).toBe(true);
  });
});

describe('setPaymentId', () => {
  it('throws when no order row was updated, so a payer page is never handed out over nothing', async () => {
    await expect(setPaymentId('YZ-0123456789', 'HX-100')).rejects.toThrow();
    const o = order();
    await recordOrder(o);
    await expect(setPaymentId(o.reference, 'HX-100')).resolves.toBeUndefined();
  });
});

describe('applyOrderStatus: a lost race must not drop a paid result', () => {
  it('re-applies when the order it saw as pending has since become failed (a decline landed first)', async () => {
    const o = order();
    await recordOrder(o);
    await markOrderFailed(o.reference); // the decline callback wins the race...
    // ...while this reconcile still believes the order is pending and holds an authenticated SUCCESS.
    expect(await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'paid')).toBe('paid');
    expect((await findOrderByReference(o.reference))?.status).toBe('paid');
  });

  it('does not overwrite an order that a concurrent reconcile already settled', async () => {
    const o = order();
    await recordOrder(o);
    await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'paid');
    expect(await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'failed')).toBe('paid');
    expect((await findOrderByReference(o.reference))?.status).toBe('paid');
  });
});

describe('the local file store is never active in production by accident', () => {
  it('needs ALLOW_LOCAL_STORE=1 in a production build, even with LOCAL_STORE_DIR set', () => {
    expect(localDir({ NODE_ENV: 'production', LOCAL_STORE_DIR: '/data' })).toBeNull();
    expect(localDir({ NODE_ENV: 'production', LOCAL_STORE_DIR: '/data', ALLOW_LOCAL_STORE: 'yes' })).toBeNull();
    expect(localDir({ NODE_ENV: 'production', LOCAL_STORE_DIR: '/data', ALLOW_LOCAL_STORE: '1' })).toBe('/data');
  });

  it('keeps development and test usable', () => {
    expect(localDir({ NODE_ENV: 'test', LOCAL_STORE_DIR: '/data' })).toBe('/data');
    expect(localDir({ NODE_ENV: 'development' })).toMatch(/.data$/);
    expect(localDir({ NODE_ENV: 'test' })).toBeNull();
  });
});
