// Integration tests against a REAL Postgres. They run only when TEST_DATABASE_URL is set; otherwise the
// whole file is skipped, so `npm test` needs no database.
//
//   TEST_DATABASE_URL=postgres://... npx vitest run lib/server/db.integration.test.ts
//
// Everything happens in a throwaway SCHEMA that is created for the run and dropped at the end, so no
// existing table is ever read or written, even when pointed at a live database.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../../scripts/migrate.mjs';
import { getPool } from '@/lib/db/pool';
import {
  applyOrderStatus,
  findOrderByPaymentId,
  findOrderByReference,
  listUnsettledByProvider,
  markOrderFailed,
  newCallbackToken,
  newOrderReference,
  recordOrder,
  setPaymentId,
  touchChecked,
  type OrderRecord,
} from './orders';
import { recordEnquiry } from './store';

const BASE = process.env.TEST_DATABASE_URL?.trim();
const SCHEMA = `yz_it_${Math.random().toString(36).slice(2, 10)}`;
const MIGRATIONS = path.resolve(__dirname, '..', '..', 'db', 'migrations');

function urlWithSchema(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

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
    lines: [
      { fragranceId: 'yz-01', fragranceName: 'Sampaguita Nocturne', volumeId: '50ml', volumeLabel: '50 ml', cases: 3, casePack: 12, bottles: 36, unitPrice: 880, lineTotal: 31680 },
    ],
    ...over,
  };
}

const DAY = 86_400_000;
const WINDOW = { minAgeMs: 0, maxAgeMs: 31 * DAY, failedMaxAgeMs: 2 * DAY, pendingLimit: 50, failedLimit: 50 };

describe.skipIf(!BASE)('Postgres store (real database, throwaway schema)', () => {
  let admin: pg.Client;
  let count: (table: string) => Promise<number>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: BASE });
    await admin.connect();
    await admin.query(`create schema ${SCHEMA}`);
    // Migrate INTO the throwaway schema, with the same runner production uses.
    const migrator = new pg.Client({ connectionString: urlWithSchema(BASE!, SCHEMA) });
    await migrator.connect();
    await migrator.query(`set search_path to ${SCHEMA}`);
    await migrate(migrator, MIGRATIONS);
    await migrator.end();

    vi.stubEnv('DATABASE_URL', urlWithSchema(BASE!, SCHEMA));
    vi.stubEnv('LOCAL_STORE_DIR', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    count = async (table) => Number((await admin.query(`select count(*) from ${SCHEMA}.${table}`)).rows[0].count);
  });

  afterAll(async () => {
    await getPool()?.end().catch(() => undefined);
    await admin?.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await admin.query(`truncate ${SCHEMA}.yz_order_items, ${SCHEMA}.yz_orders, ${SCHEMA}.yz_enquiry_items, ${SCHEMA}.yz_enquiries cascade`);
  });

  describe('migrations', () => {
    it('are tracked and idempotent: a second run applies nothing', async () => {
      const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
      const done = (await admin.query(`select name from ${SCHEMA}.schema_migrations order by name`)).rows.map((r) => r.name);
      expect(done).toEqual(files.sort());
      const again = new pg.Client({ connectionString: urlWithSchema(BASE!, SCHEMA) });
      await again.connect();
      await again.query(`set search_path to ${SCHEMA}`);
      expect(await migrate(again, MIGRATIONS)).toEqual([]);
      await again.end();
    });

    it('create every column and constraint the application relies on', async () => {
      const cols = (await admin.query(`select column_name from information_schema.columns where table_schema = $1 and table_name = 'yz_orders'`, [SCHEMA])).rows.map((r) => r.column_name);
      for (const c of ['payment_provider', 'payment_id', 'callback_token', 'updated_at', 'last_checked_at', 'link_id', 'total']) expect(cols).toContain(c);
      await expect(admin.query(`update ${SCHEMA}.yz_orders set status = 'bogus'`)).resolves.toBeTruthy(); // no rows yet: fine
      await recordOrder(order());
      await expect(admin.query(`update ${SCHEMA}.yz_orders set status = 'bogus'`)).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('recording', () => {
    it('writes an order and its lines, and reads it back without contact details', async () => {
      const o = order();
      await recordOrder(o);
      expect(await count('yz_orders')).toBe(1);
      expect(await count('yz_order_items')).toBe(1);
      const found = await findOrderByReference(o.reference);
      expect(found).toMatchObject({ reference: o.reference, status: 'pending', total: 31680, totalCases: 3, totalBottles: 36, paymentProvider: 'hexacorp', paymentId: null, callbackToken: o.callbackToken });
      expect(found!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(JSON.stringify(found)).not.toMatch(/casabella|Ana Reyes|Rizal/i);
    });

    it('is ATOMIC: a bad line rolls the whole order back, leaving no header behind', async () => {
      const bad = order({ lines: [{ fragranceId: 'yz-01', fragranceName: 'x', volumeId: '50ml', volumeLabel: '50 ml', cases: 0, casePack: 12, bottles: 0, unitPrice: 880, lineTotal: 0 }] });
      await expect(recordOrder(bad)).rejects.toMatchObject({ name: 'StoreUnavailableError' });
      expect(await count('yz_orders')).toBe(0);
      expect(await count('yz_order_items')).toBe(0);
    });

    it('refuses a duplicate reference without writing a second row', async () => {
      const o = order();
      await recordOrder(o);
      await expect(recordOrder({ ...order(), reference: o.reference })).rejects.toMatchObject({ name: 'StoreUnavailableError' });
      expect(await count('yz_orders')).toBe(1);
    });

    it('records an enquiry with its lines, and an open application with none', async () => {
      await recordEnquiry({ reference: 'YZE-0123456789', company: 'Casa Bella', contactName: 'Ana', email: 'a@b.co', phone: '', city: '', businessType: 'boutique', storeWebsite: '', wantsSamples: true, message: '', lines: [{ fragranceId: 'yz-01', fragranceName: 'Sampaguita Nocturne', volumeId: '50ml', volumeLabel: '50 ml', cases: 2 }] });
      await recordEnquiry({ reference: 'YZE-9876543210', company: 'Open', contactName: 'Bo', email: 'b@c.co', phone: '', city: '', businessType: 'other', storeWebsite: '', wantsSamples: false, message: '', lines: [] });
      expect(await count('yz_enquiries')).toBe(2);
      expect(await count('yz_enquiry_items')).toBe(1);
      const row = (await admin.query(`select phone, message, wants_samples from ${SCHEMA}.yz_enquiries where reference = 'YZE-0123456789'`)).rows[0];
      expect(row).toEqual({ phone: null, message: null, wants_samples: true }); // empty strings are stored as NULL
    });
  });

  describe('payment id', () => {
    it('is stored, found by, and UNIQUE: one Hexacorp transaction cannot belong to two orders', async () => {
      const a = order();
      const b = order();
      await recordOrder(a);
      await recordOrder(b);
      await setPaymentId(a.reference, 'HX-100');
      expect((await findOrderByPaymentId('HX-100'))?.reference).toBe(a.reference);
      await expect(setPaymentId(b.reference, 'HX-100')).rejects.toMatchObject({ name: 'StoreUnavailableError' });
      expect((await findOrderByReference(b.reference))?.paymentId).toBeNull();
      expect((await findOrderByPaymentId('HX-100'))?.reference).toBe(a.reference);
    });

    it('throws when no row matched, so a payer page is never handed out over nothing', async () => {
      await expect(setPaymentId('YZ-0123456789', 'HX-1')).rejects.toMatchObject({ name: 'StoreUnavailableError' });
    });
  });

  describe('status changes', () => {
    it('are conditional in the UPDATE itself: failed never overwrites paid, and paid beats a stale failed', async () => {
      const o = order();
      await recordOrder(o);
      await markOrderFailed(o.reference);
      expect((await findOrderByReference(o.reference))?.status).toBe('failed');
      // the reconcile still believes `pending` while the row is already `failed`: it must still land `paid`
      expect(await applyOrderStatus({ reference: o.reference, status: 'pending' }, 'paid')).toBe('paid');
      await markOrderFailed(o.reference);
      expect(await applyOrderStatus({ reference: o.reference, status: 'paid' }, 'failed')).toBe('paid');
      expect((await findOrderByReference(o.reference))?.status).toBe('paid');
    });

    it('cannot be won twice by concurrent writers: exactly one transition happens', async () => {
      const o = order();
      await recordOrder(o);
      const results = await Promise.all(Array.from({ length: 8 }, () => applyOrderStatus({ reference: o.reference, status: 'pending' }, 'paid')));
      expect(results.every((r) => r === 'paid')).toBe(true);
      expect((await findOrderByReference(o.reference))?.status).toBe('paid');
    });
  });

  describe('the sweep', () => {
    it('lists pending and recently failed card orders only, with separate budgets', async () => {
      const abandoned: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const o = order();
        await recordOrder(o);
        abandoned.push(o.reference);
      }
      const failed = order();
      await recordOrder(failed);
      await setPaymentId(failed.reference, 'HX-RETRY');
      await markOrderFailed(failed.reference);
      const invoice = order({ paymentProvider: null });
      await recordOrder(invoice);
      const paid = order();
      await recordOrder(paid);
      await applyOrderStatus({ reference: paid.reference, status: 'pending' }, 'paid');

      const sweep = await listUnsettledByProvider('hexacorp', { ...WINDOW, pendingLimit: 2, failedLimit: 5 });
      const refs = sweep.orders.map((o) => o.reference);
      expect(refs).toContain(failed.reference); // the failed order is never crowded out
      expect(refs).not.toContain(invoice.reference);
      expect(refs).not.toContain(paid.reference);
      expect(sweep.orders.filter((o) => o.status === 'pending')).toHaveLength(2);
      expect(sweep.truncated).toBe(true);
    });

    it('is round-robin (nulls first): checked orders go to the back, so every order is reached', async () => {
      const all: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const o = order();
        await recordOrder(o);
        all.push(o.reference);
      }
      const seen = new Set<string>();
      for (let pass = 0; pass < 3; pass += 1) {
        const { orders } = await listUnsettledByProvider('hexacorp', { ...WINDOW, pendingLimit: 2, failedLimit: 5 });
        for (const o of orders) {
          seen.add(o.reference);
          await touchChecked(o.reference);
        }
      }
      expect([...seen].sort()).toEqual([...all].sort());
    });

    it('skips a failed order with no reference, an order inside the minimum age and one past the window', async () => {
      const never = order();
      await recordOrder(never);
      await markOrderFailed(never.reference);
      const young = order();
      await recordOrder(young);
      const old = order();
      await recordOrder(old);
      await admin.query(`update ${SCHEMA}.yz_orders set created_at = now() - interval '40 days' where reference = $1`, [old.reference]);

      const refs = (await listUnsettledByProvider('hexacorp', { ...WINDOW, minAgeMs: 60_000 })).orders.map((o) => o.reference);
      expect(refs).not.toContain(never.reference);
      expect(refs).not.toContain(young.reference);
      expect(refs).not.toContain(old.reference);
    });
  });

  describe('SQL injection', () => {
    it('is impossible through a reference, a payment id or a token: values are bound, never interpolated', async () => {
      const o = order();
      await recordOrder(o);
      const hostile = `YZ-0123456789'; drop table ${SCHEMA}.yz_orders; --`;
      expect(await findOrderByReference(hostile)).toBeNull();
      expect(await findOrderByPaymentId(`x' or '1'='1`)).toBeNull();
      // a hostile payment id is stored as an inert string
      await setPaymentId(o.reference, `HX'); delete from ${SCHEMA}.yz_orders; --`);
      expect(await count('yz_orders')).toBe(1);
      expect((await findOrderByReference(o.reference))?.paymentId).toContain('delete from');
    });
  });

  describe('failure', () => {
    it('maps an unreachable database to StoreUnavailableError, logging only a code', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.stubEnv('DATABASE_URL', 'postgres://user:secretpass@127.0.0.1:1/db');
      await expect(findOrderByReference('YZ-0123456789')).rejects.toMatchObject({ name: 'StoreUnavailableError' });
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain('secretpass');
      expect(logged).not.toContain('127.0.0.1');
      vi.stubEnv('DATABASE_URL', urlWithSchema(BASE!, SCHEMA));
    });
  });
});
