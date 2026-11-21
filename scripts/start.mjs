// `npm start`: apply any pending database migrations, THEN serve.
//
// Why this exists: the schema must match the code before the code takes traffic, on every deploy, with
// no step a person can forget. Railway's pre-deploy hook is not applied to this service (checked: it never
// ran), so the check lives here, in the one command that always runs.
//
//   - DATABASE_URL set    migrate (advisory-locked, transactional, idempotent), then start Next.
//                         A FAILED migration exits non-zero and Next never starts: the app does not serve
//                         against a schema it does not match, and the previous deployment keeps running.
//   - DATABASE_URL unset  start Next without migrating. Public pages work; orders and enquiries answer 503
//                         (or use the dev-only local file store). A loud warning says so in production.
//
// Plain Node: no dev tooling is needed at runtime. Signals are forwarded so Railway can stop the container
// cleanly.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { runMigrations } from './migrate.mjs';

const url = process.env.DATABASE_URL?.trim();

if (url) {
  try {
    const applied = await runMigrations(url);
    console.log(applied.length ? `[start] migrations applied: ${applied.join(', ')}` : '[start] database schema is up to date');
  } catch (error) {
    // The code only: a database message can quote a statement or a row.
    console.error('[start] MIGRATION FAILED: not starting the server', { message: error?.message, code: error?.code });
    process.exit(1);
  }
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[start] WARNING: DATABASE_URL is not set. The site will serve, but orders and enquiries cannot be saved (503).');
}

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'start', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
