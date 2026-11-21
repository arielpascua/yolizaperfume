import 'server-only';
// Persistence for enquiries, plus the shared helpers that lib/server/orders.ts builds on (orders have
// their own module because they must be read back and moved between states).
//
// SUCCESS MEANS THE ROWS WERE SAVED: anything else throws StoreUnavailableError, so the route answers
// 503 and the visitor is told honestly. An order that nobody recorded is worse than an order that was
// refused.
//
// Two backends, chosen by environment:
//   1. Postgres (Railway), when DATABASE_URL is set. A header and its lines are written in ONE
//      transaction, so a half-written order or enquiry cannot exist.
//   2. Local files under LOCAL_STORE_DIR, for development and the e2e run only. `npm run dev` defaults it
//      to ./.data. A PRODUCTION build refuses it unless ALLOW_LOCAL_STORE=1 as well (see localDir).
//
// NEVER LOG ROW DATA: only fixed tokens and database error CODES are logged, never a database
// message, which can echo the row.

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { databaseUrl, errorCode, insertManySql, insertSql, withTransaction } from '@/lib/db/pool';

export class StoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreUnavailableError';
  }
}

export interface EnquiryRecord {
  reference: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  businessType: string;
  storeWebsite: string;
  wantsSamples: boolean;
  message: string;
  lines: Array<{ fragranceId: string; fragranceName: string; volumeId: string; volumeLabel: string; cases: number }>;
}

export const orNull = (v: string) => (v === '' ? null : v);

/**
 * The local file store, or null when it must not be used. In a production build it is OFF unless
 * ALLOW_LOCAL_STORE=1 as well as LOCAL_STORE_DIR, so a stray variable can never quietly send real
 * orders to a folder on one server instance (where card orders could not be reconciled safely).
 * `npm run dev` defaults it to ./.data.
 */
export function localDir(env: Record<string, string | undefined> = process.env): string | null {
  const production = env.NODE_ENV === 'production';
  if (production && env.ALLOW_LOCAL_STORE !== '1') return null;
  const configured = env.LOCAL_STORE_DIR?.trim();
  if (configured) return configured;
  return env.NODE_ENV === 'development' ? path.join(process.cwd(), '.data') : null;
}

export async function appendLocal(dir: string, file: string, record: unknown): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, file), `${JSON.stringify({ at: new Date().toISOString(), ...(record as object) })}\n`, 'utf8');
  } catch {
    console.error('[store] local write failed');
    throw new StoreUnavailableError('local store write failed');
  }
}

/** Inserts a header row and its item rows in ONE transaction: all of it, or none of it. */
export async function insertWithItems(opts: {
  headerTable: string;
  itemsTable: string;
  header: Record<string, unknown>;
  items: Record<string, unknown>[];
  tag: string;
}): Promise<void> {
  try {
    await withTransaction(async (client) => {
      const head = insertSql(opts.headerTable, opts.header);
      await client.query(head.text, head.values);
      if (opts.items.length > 0) {
        const lines = insertManySql(opts.itemsTable, opts.items);
        await client.query(lines.text, lines.values);
      }
    });
  } catch (error) {
    console.error(`[${opts.tag}] insert failed`, { code: errorCode(error) });
    throw new StoreUnavailableError('insert failed');
  }
}

export function hasDatabase(): boolean {
  return databaseUrl() !== null;
}

export async function recordEnquiry(input: EnquiryRecord): Promise<void> {
  if (!hasDatabase()) {
    const dir = localDir();
    if (!dir) throw new StoreUnavailableError('no store is configured for enquiries');
    return appendLocal(dir, 'enquiries.jsonl', input);
  }
  const id = randomUUID();
  await insertWithItems({
    headerTable: 'yz_enquiries',
    itemsTable: 'yz_enquiry_items',
    tag: 'enquiry',
    header: {
      id,
      reference: input.reference,
      status: 'new',
      company: input.company,
      contact_name: input.contactName,
      email: input.email,
      phone: orNull(input.phone),
      city: orNull(input.city),
      business_type: input.businessType,
      store_website: orNull(input.storeWebsite),
      wants_samples: input.wantsSamples,
      message: orNull(input.message),
    },
    items: input.lines.map((l) => ({
      enquiry_id: id,
      fragrance_id: l.fragranceId,
      fragrance_name: l.fragranceName,
      volume_id: l.volumeId,
      volume_label: l.volumeLabel,
      cases: l.cases,
    })),
  });
}
