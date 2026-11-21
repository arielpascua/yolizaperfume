// Shared by the payment route tests: a temp local order store and a way to file an order in it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { findOrderByReference, newCallbackToken, newOrderReference, recordOrder, type OrderRecord, type StoredOrder } from '@/lib/server/orders';

export const ORDER_TOTAL = 141132;

let current = '';

/** Points the order store at a fresh temp folder and away from any database. Call in beforeEach. */
export function setupStore(): string {
  current = mkdtempSync(path.join(tmpdir(), 'yz-pay-'));
  vi.stubEnv('LOCAL_STORE_DIR', current);
  vi.stubEnv('DATABASE_URL', '');
  return current;
}

/** Call in afterEach. */
export function teardownStore(): void {
  vi.unstubAllEnvs();
  if (current) rmSync(current, { recursive: true, force: true });
  current = '';
}

export async function fileOrder(over: Partial<OrderRecord> = {}): Promise<StoredOrder> {
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
    totals: { cases: 14, bottles: 168, subtotal: 148560, discountPercent: 5, discount: 7428, total: ORDER_TOTAL },
    lines: [],
    ...over,
  };
  await recordOrder(record);
  return (await findOrderByReference(reference))!;
}
