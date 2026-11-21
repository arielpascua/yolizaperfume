import 'server-only';

// The ONE connection to Postgres (Railway's Postgres service). SERVER ONLY, enforced by the import
// above: if a Client Component ever imports this file the build fails, which is the only reliable way
// to keep the connection string out of a browser bundle. The browser never talks to the database.
//
// DATABASE_URL is the whole configuration. On Railway it is a reference to the Postgres service
// (`${{Postgres.DATABASE_URL}}`), which resolves to the PRIVATE network address, so the database is not
// exposed to the internet by this app. Unset means "no database": the caller then uses the dev-only
// local file store or answers 503. The URL is never logged, and nor is a database error MESSAGE (it can
// echo a row); only the error CODE is.

import { Pool, type PoolClient } from 'pg';

export function databaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.DATABASE_URL?.trim();
  return url ? url : null;
}

let pool: Pool | null = null;
let poolUrl: string | null = null;

/** The shared pool, or null when no database is configured. Rebuilt only if the URL itself changes. */
export function getPool(): Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (pool && poolUrl === url) return pool;
  // A different URL (tests only) replaces the old pool; the old one is drained in the background.
  if (pool) void pool.end().catch(() => undefined);
  pool = new Pool({
    connectionString: url,
    // Small on purpose: a handful of concurrent requests, and a database that is not shared with anything.
    max: 5,
    // EVERY database attempt is bounded: without a ceiling a hung database holds the buyer's request.
    connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    idleTimeoutMillis: 30_000,
    application_name: 'yoliza-web',
  });
  poolUrl = url;
  // An idle client erroring (the database restarting, say) must not crash the process.
  pool.on('error', (err: Error & { code?: string }) => {
    console.error('[db] idle client error', { code: err.code ?? err.name });
  });
  return pool;
}

/** Runs `work` in one transaction: committed if it resolves, rolled back if it throws. */
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = getPool();
  if (!p) throw new Error('database is not configured');
  const client = await p.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    // A failed rollback must not mask the original error.
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The error CODE only (a Postgres SQLSTATE such as 23505, or a Node code such as ECONNREFUSED). */
export function errorCode(error: unknown): string {
  const e = error as { code?: unknown; name?: unknown } | null;
  if (e && typeof e.code === 'string') return e.code;
  return e && typeof e.name === 'string' ? e.name : 'unknown';
}

/** Identifiers are interpolated into SQL, so they must be plain names from OUR code, never input. */
export function ident(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('invalid SQL identifier');
  return name;
}

export function insertSql(table: string, row: Record<string, unknown>): { text: string; values: unknown[] } {
  const cols = Object.keys(row).map(ident);
  return {
    text: `insert into ${ident(table)} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    values: cols.map((c) => row[c]),
  };
}

/** One multi-row insert. Every row must have the same columns, in the same order. */
export function insertManySql(table: string, rows: Record<string, unknown>[]): { text: string; values: unknown[] } {
  if (rows.length === 0) throw new Error('no rows to insert');
  const cols = Object.keys(rows[0]).map(ident);
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const marks = cols.map((c) => {
      values.push(row[c]);
      return `$${values.length}`;
    });
    return `(${marks.join(', ')})`;
  });
  return { text: `insert into ${ident(table)} (${cols.join(', ')}) values ${tuples.join(', ')}`, values };
}
