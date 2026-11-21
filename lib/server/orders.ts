import 'server-only';
// Orders: filing them, reading them back, and moving them between states.
//
// WHO MAY MOVE AN ORDER TO `paid`: only lib/server/paymentReconcile.ts, from an authenticated
// Transaction Inquiry. Nothing else in the codebase writes `paid`. In invoice mode (no gateway)
// an order simply stays `pending` until a person changes it by hand.
//
// Two backends, as for enquiries (lib/server/store.ts): Postgres (DATABASE_URL), or one JSON file per
// order under LOCAL_STORE_DIR/orders for development and the e2e run. Every function throws
// StoreUnavailableError rather than pretending, and NOTHING HERE LOGS ROW DATA (only error CODES).
// Every query is parameterised: the only things interpolated into SQL are fixed column names from this
// file, never anything that came from a request.

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { QueryResultRow } from 'pg';
import { errorCode, getPool } from '@/lib/db/pool';
import { StoreUnavailableError, hasDatabase, insertWithItems, localDir, orNull } from './store';

export type OrderStatus = 'pending' | 'invoiced' | 'paid' | 'failed' | 'shipped' | 'cancelled';

export interface OrderRecord {
  reference: string;
  linkId: string;
  /** Authorises the buyer's own status polling after they return from the payment page. */
  callbackToken: string;
  /** The gateway this order is paid on, or null in invoice mode. */
  paymentProvider: string | null;
  buyer: { company: string; contactName: string; email: string; phone: string; taxId: string };
  shipping: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string };
  poNumber: string;
  notes: string;
  totals: { cases: number; bottles: number; subtotal: number; discountPercent: number; discount: number; total: number };
  lines: Array<{
    fragranceId: string;
    fragranceName: string;
    volumeId: string;
    volumeLabel: string;
    cases: number;
    casePack: number;
    bottles: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}

/** What reconciliation and the buyer's status page need: no contact details, no address. */
export interface StoredOrder {
  reference: string;
  status: OrderStatus;
  /** Whole pesos. Bound against the provider's reported amount before `paid`. */
  total: number;
  totalCases: number;
  totalBottles: number;
  paymentProvider: string | null;
  /** The provider's own transaction id (Hexacorp `reference_number`), once known. */
  paymentId: string | null;
  callbackToken: string;
  createdAt: string;
}

export const ORDER_REFERENCE_RE = /^YZ-[0-9A-F]{10}$/;

export function newOrderReference(): string {
  return `YZ-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

export function newCallbackToken(): string {
  return randomBytes(24).toString('base64url');
}

export function safeTokenEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * True when the provider's reported amount does not match what we charged. STRICT: an absent or
 * non-finite amount IS a mismatch and blocks `paid`. Compares integer centavos so 1200 and 1200.00
 * agree with no float epsilon. Refusing is operator-recoverable; wrongly fulfilling is not.
 */
export function paymentAmountMismatches(reportedPesos: number | null, expectedPesos: number): boolean {
  if (reportedPesos === null || !Number.isFinite(reportedPesos)) return true;
  return Math.round(reportedPesos * 100) !== Math.round(expectedPesos * 100);
}

const SELECT = 'reference, status, total, total_cases, total_bottles, payment_provider, payment_id, callback_token, created_at';

function fromRow(row: QueryResultRow): StoredOrder {
  return {
    reference: String(row.reference),
    status: row.status as OrderStatus,
    total: Number(row.total),
    totalCases: Number(row.total_cases),
    totalBottles: Number(row.total_bottles),
    paymentProvider: typeof row.payment_provider === 'string' ? row.payment_provider : null,
    paymentId: typeof row.payment_id === 'string' ? row.payment_id : null,
    callbackToken: String(row.callback_token ?? ''),
    // pg returns timestamptz as a Date.
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Runs one parameterised query, mapping any database failure to StoreUnavailableError (code only logged). */
async function query(tag: string, text: string, values: unknown[]): Promise<QueryResultRow[]> {
  const pool = getPool();
  if (!pool) throw new StoreUnavailableError('database is not configured');
  try {
    return (await pool.query(text, values)).rows;
  } catch (error) {
    console.error(`[orders] ${tag} failed`, { code: errorCode(error) });
    throw new StoreUnavailableError(`order ${tag} failed`);
  }
}

// ----- local file backend -------------------------------------------------

interface LocalOrder extends OrderRecord {
  at: string;
  status: OrderStatus;
  paymentId: string | null;
  /** When the sweeper last looked at this order. Drives round-robin so no order is starved. */
  checkedAt?: string;
}

function localFile(reference: string): string | null {
  const dir = localDir();
  // The reference is validated BEFORE it becomes part of a path: it may arrive from the network.
  if (!dir || !ORDER_REFERENCE_RE.test(reference)) return null;
  return path.join(dir, 'orders', `${reference}.json`);
}

function fromLocal(o: LocalOrder): StoredOrder {
  return {
    reference: o.reference,
    status: o.status,
    total: o.totals.total,
    totalCases: o.totals.cases,
    totalBottles: o.totals.bottles,
    paymentProvider: o.paymentProvider,
    paymentId: o.paymentId,
    callbackToken: o.callbackToken,
    createdAt: o.at,
  };
}

async function readLocal(reference: string): Promise<LocalOrder | null> {
  const file = localFile(reference);
  if (!file) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as LocalOrder;
  } catch {
    return null;
  }
}

async function writeLocal(order: LocalOrder): Promise<void> {
  const file = localFile(order.reference);
  if (!file) throw new StoreUnavailableError('no local store for orders');
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(order), 'utf8');
  } catch {
    console.error('[orders] local write failed');
    throw new StoreUnavailableError('local store write failed');
  }
}

// ----- filing -------------------------------------------------------------

export async function recordOrder(input: OrderRecord): Promise<void> {
  if (!hasDatabase()) {
    if (!localDir()) throw new StoreUnavailableError('no store is configured for orders');
    return writeLocal({ ...input, at: new Date().toISOString(), status: 'pending', paymentId: null });
  }
  const id = randomUUID();
  await insertWithItems({
    headerTable: 'yz_orders',
    itemsTable: 'yz_order_items',
    tag: 'order',
    header: {
      id,
      reference: input.reference,
      status: 'pending',
      link_id: input.linkId,
      callback_token: input.callbackToken,
      payment_provider: input.paymentProvider,
      company: input.buyer.company,
      contact_name: input.buyer.contactName,
      email: input.buyer.email,
      phone: input.buyer.phone,
      tax_id: orNull(input.buyer.taxId),
      ship_line1: input.shipping.line1,
      ship_line2: orNull(input.shipping.line2),
      ship_city: input.shipping.city,
      ship_region: orNull(input.shipping.region),
      ship_postal_code: input.shipping.postalCode,
      ship_country: input.shipping.country,
      po_number: orNull(input.poNumber),
      notes: orNull(input.notes),
      total_cases: input.totals.cases,
      total_bottles: input.totals.bottles,
      subtotal: input.totals.subtotal,
      discount_percent: input.totals.discountPercent,
      discount: input.totals.discount,
      total: input.totals.total,
    },
    items: input.lines.map((l) => ({
      order_id: id,
      fragrance_id: l.fragranceId,
      fragrance_name: l.fragranceName,
      volume_id: l.volumeId,
      volume_label: l.volumeLabel,
      cases: l.cases,
      case_pack: l.casePack,
      bottles: l.bottles,
      unit_price: l.unitPrice,
      line_total: l.lineTotal,
    })),
  });
}

// ----- reading ------------------------------------------------------------

export async function findOrderByReference(reference: string): Promise<StoredOrder | null> {
  if (!ORDER_REFERENCE_RE.test(reference)) return null;
  if (!hasDatabase()) {
    const o = await readLocal(reference);
    return o ? fromLocal(o) : null;
  }
  const rows = await query('read', `select ${SELECT} from yz_orders where reference = $1 limit 1`, [reference]);
  return rows[0] ? fromRow(rows[0]) : null;
}

/** Hexacorp's `reference_number`: the documented fallback for finding an order from a delivery. */
export async function findOrderByPaymentId(paymentId: string): Promise<StoredOrder | null> {
  if (paymentId.length === 0 || paymentId.length > 128) return null;
  if (!hasDatabase()) {
    const dir = localDir();
    if (!dir) return null;
    try {
      for (const name of await readdir(path.join(dir, 'orders'))) {
        const o = await readLocal(name.replace(/\.json$/, ''));
        if (o && o.paymentId === paymentId) return fromLocal(o);
      }
    } catch {
      return null;
    }
    return null;
  }
  const rows = await query('read', `select ${SELECT} from yz_orders where payment_id = $1 limit 1`, [paymentId]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export interface UnsettledSweep {
  orders: StoredOrder[];
  /**
   * True when either budget was FILLED, so there may be orders this sweep did not reach. Nothing is
   * lost (the next sweep starts with whoever has waited longest), but a persistent backlog is
   * something a person should hear about, so the scheduled job warns on it.
   */
  truncated: boolean;
}

/**
 * Orders on `provider` the sweeper must still look at:
 *   - every `pending` order inside the age window (even one with no stored reference, which the
 *     reconcile reports as an anomaly rather than skipping in silence), and
 *   - every `failed` order that HAS a stored Hexacorp reference, but only for `failedMaxAgeMs`. A
 *     decline callback can mark an order failed and the payer may then retry on Hexacorp's page and
 *     succeed, so `failed` is not final. A `failed` order with no reference never reached Hexacorp
 *     (the create was rejected), so there is nothing to ask.
 *
 * TWO INDEPENDENT BUDGETS, and ROUND-ROBIN, because a single oldest-first list can be starved:
 * abandoned checkouts stay `pending` for the whole window (Hexacorp answers "no transaction" or
 * "pending" and nothing changes), so enough of them would fill an oldest-first list and every NEWER
 * order, including every `failed` one, would never be reached. Failed orders therefore get their own
 * budget, and each list is ordered by when the sweeper last looked (never-checked first), not by age.
 */
export async function listUnsettledByProvider(
  provider: string,
  opts: { minAgeMs: number; maxAgeMs: number; failedMaxAgeMs: number; pendingLimit: number; failedLimit: number; now?: number },
): Promise<UnsettledSweep> {
  const now = opts.now ?? Date.now();
  const newest = now - opts.minAgeMs;
  const oldestPending = now - opts.maxAgeMs;
  const oldestFailed = now - Math.min(opts.failedMaxAgeMs, opts.maxAgeMs);
  // Never-checked first, then least recently checked, then oldest.
  const waited = (a: LocalOrder, b: LocalOrder) =>
    (a.checkedAt ?? '').localeCompare(b.checkedAt ?? '') || a.at.localeCompare(b.at);

  if (!hasDatabase()) {
    const dir = localDir();
    if (!dir) return { orders: [], truncated: false };
    const pending: LocalOrder[] = [];
    const failed: LocalOrder[] = [];
    try {
      for (const name of await readdir(path.join(dir, 'orders'))) {
        const o = await readLocal(name.replace(/\.json$/, ''));
        if (!o || o.paymentProvider !== provider) continue;
        const t = Date.parse(o.at);
        if (t > newest) continue;
        if (o.status === 'pending' && t > oldestPending) pending.push(o);
        else if (o.status === 'failed' && Boolean(o.paymentId) && t > oldestFailed) failed.push(o);
      }
    } catch {
      return { orders: [], truncated: false };
    }
    pending.sort(waited);
    failed.sort(waited);
    return {
      orders: [...failed.slice(0, opts.failedLimit), ...pending.slice(0, opts.pendingLimit)].map(fromLocal),
      truncated: pending.length > opts.pendingLimit || failed.length > opts.failedLimit,
    };
  }

  // One more row than the budget, so "there is more" is knowable without a second COUNT query.
  const order = 'order by last_checked_at asc nulls first, created_at asc';
  const [pending, failed] = await Promise.all([
    query(
      'sweep list',
      `select ${SELECT} from yz_orders
        where status = 'pending' and payment_provider = $1 and created_at < $2 and created_at > $3
        ${order} limit $4`,
      [provider, new Date(newest), new Date(oldestPending), opts.pendingLimit + 1],
    ),
    query(
      'sweep list',
      `select ${SELECT} from yz_orders
        where status = 'failed' and payment_provider = $1 and payment_id is not null and created_at < $2 and created_at > $3
        ${order} limit $4`,
      [provider, new Date(newest), new Date(oldestFailed), opts.failedLimit + 1],
    ),
  ]);
  return {
    orders: [...failed.slice(0, opts.failedLimit), ...pending.slice(0, opts.pendingLimit)].map(fromRow),
    truncated: pending.length > opts.pendingLimit || failed.length > opts.failedLimit,
  };
}

// ----- writing ------------------------------------------------------------

async function patchOrder(
  reference: string,
  patch: { status?: OrderStatus; paymentId?: string; checked?: boolean },
  onlyIfStatusIn?: OrderStatus[],
): Promise<boolean> {
  const now = new Date();
  if (!hasDatabase()) {
    const o = await readLocal(reference);
    if (!o) return false;
    if (onlyIfStatusIn && !onlyIfStatusIn.includes(o.status)) return false;
    if (patch.status) o.status = patch.status;
    if (patch.paymentId) o.paymentId = patch.paymentId;
    if (patch.checked) o.checkedAt = now.toISOString();
    await writeLocal(o);
    return true;
  }

  // Column names below are fixed by this function; every VALUE is a bound parameter.
  const values: unknown[] = [now];
  const sets = ['updated_at = $1'];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.status) add('status', patch.status);
  if (patch.paymentId) add('payment_id', patch.paymentId);
  if (patch.checked) add('last_checked_at', now);
  values.push(reference);
  let where = `reference = $${values.length}`;
  if (onlyIfStatusIn) {
    values.push(onlyIfStatusIn);
    where += ` and status = any($${values.length})`;
  }
  // The status condition is part of the UPDATE itself, so two concurrent writers cannot both win.
  const rows = await query('update', `update yz_orders set ${sets.join(', ')} where ${where} returning reference`, values);
  return rows.length > 0;
}

/**
 * The provider's own transaction id. Written at create time and again on every successful
 * inquiry; the overwrite is unconditional on purpose, because a write-once rule would pin the
 * wrong id permanently if the two ever differed. (payment_id is UNIQUE, so one Hexacorp transaction
 * can never be claimed by two orders: that conflict surfaces here as a failure, not a silent overwrite.)
 */
export async function setPaymentId(reference: string, paymentId: string): Promise<void> {
  if (!paymentId) return;
  // An update that matched NO row is a failure, not a success: the checkout hands out a payer page
  // only after this resolves, so it must never resolve having stored nothing.
  if (!(await patchOrder(reference, { paymentId }))) {
    throw new StoreUnavailableError('no order row was updated when storing the payment reference');
  }
}

/**
 * Records that the sweeper looked at this order, so the next sweep starts with the order that has
 * waited LONGEST rather than the oldest one. Best-effort and never allowed to fail a reconcile.
 */
export async function touchChecked(reference: string): Promise<void> {
  await patchOrder(reference, { checked: true });
}

/** The gateway refused or could not take the order: `failed`, but never over a settled order. */
export async function markOrderFailed(reference: string): Promise<void> {
  await patchOrder(reference, { status: 'failed' }, ['pending']);
}

/** Orders in these states may still be moved by a payment result. Everything else is settled or a person's. */
const MOVABLE: OrderStatus[] = ['pending', 'failed'];

/**
 * Applies a status obtained from an AUTHENTICATED provider fetch, the only source of truth.
 * Idempotent: a settled order is never revisited, and the write is conditional on the status the
 * caller saw, so two concurrent reconciles cannot both transition it.
 *
 * `failed` is NOT final: a decline callback can mark an order failed and the payer may then retry
 * on Hexacorp's page and succeed. So when the conditional write loses a race, this does not give
 * up and report whatever won: it re-reads, and if the order is STILL movable it applies the
 * authenticated result again. Otherwise a `paid` result could be dropped because a `failed` write
 * landed a moment earlier, leaving a charged buyer on a failed order.
 */
export async function applyOrderStatus(order: Pick<StoredOrder, 'reference' | 'status'>, next: OrderStatus | null): Promise<OrderStatus> {
  let seen = order.status;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!MOVABLE.includes(seen)) return seen;
    if (!next || next === seen) return seen;
    if (await patchOrder(order.reference, { status: next }, [seen])) return next;
    const now = await findOrderByReference(order.reference);
    if (!now) return seen;
    seen = now.status;
  }
  return seen;
}
