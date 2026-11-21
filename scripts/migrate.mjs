// Applies db/migrations/*.sql, in filename order, each exactly once.
//
//   npm run migrate        (also run automatically by `npm start`, see scripts/start.mjs)
//
// Plain Node on purpose: it runs on Railway at every start, where dev tooling may not be installed.
// Reads DATABASE_URL. Each migration runs in ONE transaction together with its bookkeeping row, so a
// migration either lands completely or not at all, and a failed one stops the deploy (the old version
// keeps serving). A Postgres advisory lock stops two deploys from migrating at once. The logs carry file
// names and counts only: never the connection string, and never a database error message.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const LOCK_KEY = 727_274; // arbitrary, fixed: "yz" on a phone keypad

/**
 * Applies every pending migration from `dir` using an already-connected client.
 * Returns the names applied this run (empty when the database was already up to date).
 */
export async function migrate(client, dir) {
  await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => /^\d+_[a-z0-9_]+\.sql$/.test(f)).sort();
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        // The code only: a database message can quote the statement or a row.
        throw Object.assign(new Error(`migration ${file} failed`), { code: error && error.code });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
  }
}

/**
 * Connects to `url`, applies every pending migration from `dir`, disconnects. Returns the names applied.
 * Throws on failure (with a code, never a database message).
 */
export async function runMigrations(url, dir = defaultDir()) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    return await migrate(client, dir);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function defaultDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('[migrate] DATABASE_URL is not set: nothing to migrate');
    process.exit(1);
  }
  try {
    const applied = await runMigrations(url);
    console.log(applied.length ? `[migrate] applied: ${applied.join(', ')}` : '[migrate] already up to date');
  } catch (error) {
    console.error('[migrate] FAILED', { message: error?.message, code: error?.code });
    process.exitCode = 1;
  }
}

// Run only when executed directly, so tests can import `migrate` without starting a run.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
