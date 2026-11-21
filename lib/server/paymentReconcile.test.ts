import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentProvider, ProviderPaymentStatus } from '@/lib/payments/types';
import { findOrderByReference, markOrderFailed, newCallbackToken, newOrderReference, recordOrder, setPaymentId, type OrderRecord, type StoredOrder } from './orders';
import { needsAttention, reconcileOrder } from './paymentReconcile';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yz-reconcile-'));
  vi.stubEnv('LOCAL_STORE_DIR', dir);
  vi.stubEnv('DATABASE_URL', '');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const TOTAL = 141132;

async function filed(): Promise<StoredOrder> {
  const reference = newOrderReference();
  const record: OrderRecord = {
    reference,
    linkId: 'link001',
    callbackToken: newCallbackToken(),
    paymentProvider: 'hexacorp',
    buyer: { company: 'Casa Bella', contactName: 'Ana Reyes', email: 'ana@casabella.example', phone: '09171234567', taxId: '' },
    shipping: { line1: '1 Rizal St', line2: '', city: 'Cebu City', region: '', postalCode: '6000', country: 'Philippines' },
    poNumber: '',
    notes: '',
    totals: { cases: 14, bottles: 168, subtotal: 148560, discountPercent: 5, discount: 7428, total: TOTAL },
    lines: [],
  };
  await recordOrder(record);
  // A real card order always has Hexacorp's reference by the time anything reconciles it.
  await setPaymentId(reference, 'HX-100');
  return (await findOrderByReference(reference))!;
}

function provider(status: Partial<ProviderPaymentStatus>): PaymentProvider & { getPaymentStatus: ReturnType<typeof vi.fn> } {
  return {
    name: 'hexacorp',
    isConfigured: () => true,
    createPayment: vi.fn(),
    getPaymentStatus: vi.fn().mockResolvedValue({
      rawStatus: 'success',
      orderStatus: 'paid',
      amountPesos: TOTAL,
      providerPaymentId: 'HX-100',
      requestReferenceNumber: undefined,
      ...status,
    }),
  };
}

describe('reconcileOrder', () => {
  it('marks an order paid on an authenticated success whose amount matches, and stores the Hexacorp reference', async () => {
    const order = await filed();
    const p = provider({});
    const out = await reconcileOrder(order, p);
    expect(out).toMatchObject({ from: 'pending', to: 'paid', changed: true });
    const after = await findOrderByReference(order.reference);
    expect(after).toMatchObject({ status: 'paid', paymentId: 'HX-100' });
  });

  it('asks the provider about the ORDER ROW\'s own stored reference, never anything else', async () => {
    const order = { ...(await filed()), paymentId: 'HX-STORED' };
    const p = provider({});
    await reconcileOrder(order, p);
    expect(p.getPaymentStatus).toHaveBeenCalledWith({ referenceId: order.reference, providerPaymentId: 'HX-STORED' });
  });

  it('REFUSES to mark paid when the reported amount differs, and when it is missing', async () => {
    for (const amountPesos of [TOTAL - 1, TOTAL * 100, 1, null]) {
      const order = await filed();
      const out = await reconcileOrder(order, provider({ amountPesos }));
      expect(out).toMatchObject({ changed: false, to: 'pending', blockedByAmountMismatch: true });
      expect((await findOrderByReference(order.reference))?.status).toBe('pending');
    }
  });

  it('REFUSES when the fetched payment belongs to a different order, even if the amount matches', async () => {
    const order = await filed();
    const out = await reconcileOrder(order, provider({ requestReferenceNumber: 'YZ-AAAAAAAAAA' }));
    expect(out).toMatchObject({ changed: false, blockedByReferenceMismatch: true });
    expect((await findOrderByReference(order.reference))?.status).toBe('pending');
  });

  it('accepts an absent reference: an omission by the provider must not strand a genuine payment', async () => {
    const order = await filed();
    expect((await reconcileOrder(order, provider({ requestReferenceNumber: undefined }))).to).toBe('paid');
  });

  it('records a failed payment as failed, and leaves a null (unrecognised) status untouched', async () => {
    const a = await filed();
    expect((await reconcileOrder(a, provider({ orderStatus: 'failed', amountPesos: null }))).to).toBe('failed');
    const b = await filed();
    // Hexacorp reported a status we cannot map: not a quiet no-op, an UNRESOLVED outcome the sweeper fails on.
    const out = await reconcileOrder(b, provider({ orderStatus: null, amountPesos: null }));
    expect(out).toMatchObject({ changed: false, to: 'pending', unresolved: true });
    expect(needsAttention(out)).toBe(true);
    expect((await findOrderByReference(b.reference))?.status).toBe('pending');
  });

  it('is a plain no-op, not an alarm, when Hexacorp simply has no transaction yet', async () => {
    const order = await filed();
    const out = await reconcileOrder(order, provider({ rawStatus: undefined, orderStatus: null, amountPesos: null, providerPaymentId: undefined }));
    expect(out).toMatchObject({ changed: false, to: 'pending' });
    expect(needsAttention(out)).toBe(false);
  });

  it('moves a FAILED order to paid when the payer retried and Hexacorp now says success', async () => {
    const order = await filed();
    await markOrderFailed(order.reference);
    const failed = (await findOrderByReference(order.reference))!;
    expect(failed.status).toBe('failed');
    expect(await reconcileOrder(failed, provider({}))).toMatchObject({ from: 'failed', to: 'paid', changed: true });
  });

  it('REPORTS a card order with no stored Hexacorp reference and asks the gateway nothing', async () => {
    const order = { ...(await filed()), paymentId: null };
    const p = provider({});
    const out = await reconcileOrder(order, p);
    expect(out).toMatchObject({ changed: false, unreferenced: true });
    expect(needsAttention(out)).toBe(true);
    expect(p.getPaymentStatus).not.toHaveBeenCalled();
  });

  it('flags a CONFIRMED payment on an order a person has since cancelled, invoiced or shipped', async () => {
    for (const status of ['cancelled', 'invoiced', 'shipped'] as const) {
      const order = { ...(await filed()), status };
      const out = await reconcileOrder(order, provider({}));
      expect(out, status).toMatchObject({ changed: false, to: status, unresolved: true });
      expect(needsAttention(out)).toBe(true);
    }
  });

  it('treats a result the provider marks AMBIGUOUS as unresolved even when the contradicting record has no status string', async () => {
    const order = await filed();
    const out = await reconcileOrder(order, provider({ rawStatus: undefined, orderStatus: null, amountPesos: null, ambiguous: true }));
    expect(out).toMatchObject({ changed: false, unresolved: true });
    expect((await findOrderByReference(order.reference))?.status).toBe('pending');
  });

  it('flags every refusal as needing attention', async () => {
    const mismatch = await reconcileOrder(await filed(), provider({ amountPesos: 1 }));
    const wrongOrder = await reconcileOrder(await filed(), provider({ requestReferenceNumber: 'YZ-AAAAAAAAAA' }));
    for (const o of [mismatch, wrongOrder]) expect(needsAttention(o)).toBe(true);
    expect(needsAttention(await reconcileOrder(await filed(), provider({})))).toBe(false);
  });

  it('is idempotent: a second reconcile of a paid order changes nothing', async () => {
    const order = await filed();
    await reconcileOrder(order, provider({}));
    const again = await reconcileOrder((await findOrderByReference(order.reference))!, provider({}));
    expect(again).toMatchObject({ from: 'paid', to: 'paid', changed: false });
  });

  it('cannot be talked out of paid by a later failed result', async () => {
    const order = await filed();
    await reconcileOrder(order, provider({}));
    const out = await reconcileOrder((await findOrderByReference(order.reference))!, provider({ orderStatus: 'failed' }));
    expect(out.to).toBe('paid');
  });

  it('does nothing for an order with no gateway (invoice mode)', async () => {
    const order = { ...(await filed()), paymentProvider: null };
    const out = await reconcileOrder(order, null);
    expect(out).toMatchObject({ changed: false, from: 'pending', to: 'pending' });
    expect(await reconcileOrder({ ...order, paymentProvider: 'unknown-gateway' })).toMatchObject({ changed: false });
  });

  it('propagates a failed status fetch so the caller can record it', async () => {
    const order = await filed();
    const p = provider({});
    p.getPaymentStatus.mockRejectedValue(new Error('network down'));
    await expect(reconcileOrder(order, p)).rejects.toThrow('network down');
    expect((await findOrderByReference(order.reference))?.status).toBe('pending');
  });
});
