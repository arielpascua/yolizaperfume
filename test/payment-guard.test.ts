// Standing source guards for how money is handled. Each is a rule that a future edit could break
// quietly, and each failure would be a payment bug rather than a crash.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const sources = [...walk('app'), ...walk('components'), ...walk('lib'), ...walk('scripts')].filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f),
);

describe('live cards only: there is no sandbox', () => {
  it('no source file names a sandbox host, a mode switch or a simulated outcome', () => {
    const offenders = sources.filter((f) => /sandbox|HEXACORP_MODE|HEXACORP_TEST|test_scenario|autopostback/i.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the only gateway host in the codebase is the live one', () => {
    const hosts = new Set<string>();
    for (const f of sources) for (const m of read(f).matchAll(/https?:\/\/[a-z0-9.-]*hexacorp\.xyz[^\s'"`)]*/gi)) hosts.add(new URL(m[0]).host);
    expect([...hosts].sort()).toEqual(['api.payment.hexacorp.xyz']);
  });

  it('the environment template asks for one credential set, not two', () => {
    const env = read('.env.example');
    expect(env).toMatch(/^HEXACORP_APP_UUID=/m);
    expect(env).not.toMatch(/HEXACORP_(SANDBOX|LIVE)_|HEXACORP_MODE|TEST_SCENARIO/);
  });
});

describe('only an authenticated Transaction Inquiry can mark an order paid', () => {
  it('only the reconcile module may move an order between payment states', () => {
    const callers = sources.filter((f) => /\bapplyOrderStatus\s*\(/.test(read(f)) && !/^lib\/server\/orders\.ts$/.test(f));
    expect(callers).toEqual(['lib/server/paymentReconcile.ts']);
  });

  it('no source assigns the paid state anywhere but the reconcile path', () => {
    const offenders = sources.filter((f) => /status:\s*['"]paid['"]|\.status\s*=\s*['"]paid['"]|['"]paid['"]\s*as\s+OrderStatus/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('a new order is always filed pending, whatever the caller says', () => {
    const orders = read('lib/server/orders.ts');
    expect(orders).toMatch(/status:\s*'pending'/);
    expect(orders).not.toMatch(/input\.status/);
  });

  it('the checkout route never writes a status other than failed', () => {
    const route = read('app/api/checkout/route.ts');
    expect(route).not.toMatch(/applyOrderStatus|status:\s*['"]paid['"]/);
    expect(route).toMatch(/markOrderFailed/);
  });

  it('the buyer-facing page decides nothing from the URL: it only shows what the server reports', () => {
    const ui = read('components/checkout/PaymentReturn.tsx');
    // No query parameter ever sets the phase; only the polled server answer does.
    expect(ui).not.toMatch(/get\(['"](r|status|result|paid)['"]\)/);
    expect(ui).toMatch(/\/api\/orders\//);
  });
});

describe('a payment must always be findable again', () => {
  const hexacorp = read('lib/payments/hexacorp.ts');

  it('Transaction Inquiry is never asked with our own reference', () => {
    // Neither `||` nor `??` may fall back to our own reference...
    expect(hexacorp).not.toMatch(/providerPaymentId\s*(\|\||\?\?)\s*ref\.referenceId/);
    // ...and no query string may be built from it.
    expect(hexacorp).not.toMatch(/reference_number=\$\{[^}]*referenceId/);
  });

  it('a payer page is never handed out unless Hexacorp\'s reference_number came with it', () => {
    expect(hexacorp).toMatch(/if \(!providerPaymentId\)/);
    // Only reference_number is read at create time: an arbitrary `id` is not a lookup key.
    expect(hexacorp).not.toMatch(/PROVIDER_ID_KEYS/);
  });

  it('the checkout stores the reference BEFORE answering, and a failure there is not swallowed', () => {
    const route = read('app/api/checkout/route.ts');
    const store = route.indexOf('await setPaymentId(reference, providerPaymentId)');
    const answer = route.indexOf('redirectUrl: checkoutUrl');
    expect(store).toBeGreaterThan(-1);
    expect(store).toBeLessThan(answer);
    // The success-path write has no .catch(): its failure must reach the handler that fails the order.
    expect(route.slice(store, store + 80)).not.toMatch(/\.catch/);
    expect(route).toMatch(/isTrustedPaymentUrl\(checkoutUrl\)/);
  });

  it('a failed order is re-checked by the sweeper, because failed is not final', () => {
    expect(read('app/api/admin/orders/reconcile/route.ts')).toMatch(/listUnsettledByProvider/);
    // The sweep's own query for failed orders (SQL): failed AND holding a stored reference.
    expect(read('lib/server/orders.ts')).toMatch(/status = 'failed'[\s\S]*payment_id is not null/);
  });

  it('every outcome that leaves a possibly-charged order unsettled counts as needing attention', () => {
    const rec = read('lib/server/paymentReconcile.ts');
    // Only the BODY of needsAttention counts: the flag names also appear elsewhere in the file.
    const start = rec.indexOf('export function needsAttention');
    expect(start).toBeGreaterThan(-1);
    const body = rec.slice(start, rec.indexOf('}', rec.indexOf('return', start)));
    expect(body.length).toBeGreaterThan(40);
    for (const flag of ['blockedByAmountMismatch', 'blockedByReferenceMismatch', 'unreferenced', 'unresolved']) {
      expect(body, flag).toContain(flag);
    }
    // ...and the sweeper counts through that one function rather than its own shorter list.
    expect(read('app/api/admin/orders/reconcile/route.ts')).toMatch(/filter\(needsAttention\)/);
  });

  it('the scheduled job fails on those outcomes, warns on a truncated sweep and uses no repository permissions', () => {
    const workflow = read('.github/workflows/reconcile-payments.yml');
    for (const word of ['unreferenced', 'unresolved', 'blockedByAmountMismatch', 'blockedByReferenceMismatch']) expect(workflow, word).toContain(word);
    expect(workflow).toContain('.attention');
    expect(workflow).toContain('.truncated');
    expect(workflow).toMatch(/permissions:\s*\{\}/);
    expect(workflow).toContain('https://*');
    // The run is failed (exit 1) when anything needs attention or errored.
    const exit = workflow.indexOf('exit 1', workflow.lastIndexOf('ATTENTION'));
    expect(exit).toBeGreaterThan(-1);
    expect(workflow.slice(workflow.lastIndexOf('if [ "${ATTENTION}"'), exit)).toContain('ERROR_COUNT');
  });
});

describe('logs never carry a raw error object from the gateway', () => {
  it('no console call in the webhook passes the caught error through', () => {
    const route = read('app/api/webhooks/hexacorp/route.ts');
    // A PaymentApiError carries the gateway's raw body, which is not redacted. Behaviour is also
    // tested in the route test; this catches the shorthand and the trailing-argument forms.
    const calls = [...route.matchAll(/console\.(?:error|warn|info)\(([\s\S]*?)\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toMatch(/(^|[\s,{])err\s*(,|\}|\)|$)/);
    // PaymentApiError.body is an own enumerable property, so these forms leak it as surely as passing err.
    const all = calls.join('\n');
    expect(all).not.toMatch(/stringify\(\s*err\b/);
    expect(all).not.toMatch(/\.\.\.\s*err\b/);
    expect(all).not.toMatch(/\berr\.body\b/);
  });
});

describe('the webhook is a signal, never a source of truth', () => {
  const route = read('app/api/webhooks/hexacorp/route.ts');

  it('never reads the delivered status or amount', () => {
    expect(route).not.toMatch(/payload\.(status|amount)|payload\[['"](status|amount)['"]\]|firstString\(payload,\s*['"](status|amount)['"]\)/);
  });

  it('checks the URL secret before it parses or looks anything up', () => {
    // Anchored on the CALLS (not the import line or comments that mention the same words).
    const secret = route.indexOf('if (!secretMatches(request');
    const parse = route.indexOf('await request.json()');
    const lookup = route.indexOf('await findOrderByReference(');
    expect(secret).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(secret).toBeLessThan(parse);
    expect(secret).toBeLessThan(lookup);
  });

  it('compares secrets in constant time', () => {
    expect(route).toMatch(/timingSafeEqual/);
    expect(read('app/api/admin/orders/reconcile/route.ts')).toMatch(/timingSafeEqual/);
  });

  it('reconciles the order ROW it read, not an identifier from the delivery', () => {
    expect(route).toMatch(/reconcileOrder\(order\)/);
  });
});

describe('the database is Railway Postgres through one server-only pool', () => {
  it('no source file, dependency or template mentions Supabase', () => {
    const pkg = read('package.json');
    expect(pkg).not.toMatch(/supabase/i);
    expect(pkg).toMatch(/"pg":/);
    expect(read('.env.example')).not.toMatch(/supabase/i);
    expect(sources.filter((f) => /supabase/i.test(read(f)))).toEqual([]);
  });

  it('only the pool module opens a connection, and it is server-only', () => {
    const pool = read('lib/db/pool.ts');
    expect(pool.trimStart().startsWith("import 'server-only'")).toBe(true);
    const openers = sources.filter((f) => /new (Pool|Client)\(/.test(read(f)));
    expect(openers).toEqual(['lib/db/pool.ts']);
  });

  it('every query is parameterised: no request value is interpolated into SQL text', () => {
    // SQL text lives in orders.ts and store.ts. A template literal that mixes `${...}` into a
    // statement may only interpolate the fixed fragments below, never a variable from a request.
    const allowed = /\$\{(SELECT|order|sets\.join\(', '\)|where|ident\([^)]*\)|cols\.join\(', '\)|cols\.map[^}]*|tuples\.join\(', '\)|marks\.join\(', '\)|`\$\$\{[^}]*\}`)\}/;
    for (const f of ['lib/server/orders.ts', 'lib/server/store.ts', 'lib/db/pool.ts']) {
      const text = read(f);
      const interpolated = [...text.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      const sqlish = interpolated.filter((i) => /SELECT|order\b|sets|where|ident|cols|tuples|marks/.test(i));
      for (const i of sqlish) expect(i, `${f}: ${i}`).toMatch(allowed);
    }
  });

  it('the connection string is configuration only: never public, never logged', () => {
    expect(read('.env.example')).toMatch(/^DATABASE_URL=/m);
    expect(sources.filter((f) => /NEXT_PUBLIC_[A-Z_]*DATABASE/.test(read(f)))).toEqual([]);
    const loggers = sources.filter((f) => /console\.\w+\([^;]*databaseUrl\(/.test(read(f)));
    expect(loggers).toEqual([]);
  });

  it('migrations run at every start, BEFORE the server, and a failed one stops it', () => {
    // Not a Railway hook (railway.json was found NOT to be applied to this service): the one command that
    // always runs does it.
    expect(JSON.parse(read('package.json')).scripts.start).toBe('node scripts/start.mjs');
    const start = read('scripts/start.mjs');
    const migrate = start.indexOf('await runMigrations(');
    const exit = start.indexOf('process.exit(1)');
    const spawnNext = start.indexOf("spawn(process.execPath, [nextBin, 'start'");
    expect(migrate).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(migrate); // a failure exits...
    expect(spawnNext).toBeGreaterThan(exit); // ...before Next is ever started
    // Each migration is one transaction together with its bookkeeping row, behind an advisory lock.
    const runner = read('scripts/migrate.mjs');
    expect(runner).toContain('pg_advisory_lock');
    expect(runner).toMatch(/begin[\s\S]*insert into schema_migrations[\s\S]*commit/);
  });

  it('the SQL is plain Postgres', () => {
    const sql = walk('db/migrations').map(read).join('\n');
    // No provider-specific roles or row-level security: the app connects as the database owner.
    expect(sql).not.toMatch(/\b(anon|service_role)\b|row level security|from anon, authenticated/i);
  });
});

describe('secrets stay on the server', () => {
  it('no client component imports the gateway, the order store or the reconcile path', () => {
    const clients = sources.filter((f) => /^['"]use client['"]/.test(read(f).trimStart()));
    expect(clients.length).toBeGreaterThan(0);
    const offenders = clients.filter((f) => /@\/lib\/(payments\/hexacorp|payments\/config|server\/|supabase\/|pricing['"])/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('no gateway credential or webhook secret is exposed through NEXT_PUBLIC_', () => {
    const all = [...sources.map(read), read('.env.example')].join('\n');
    expect(all).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(HEXACORP|RECONCILE|WEBHOOK)/);
  });

  it('the money-handling routes opt out of caching', () => {
    for (const f of ['app/api/checkout/route.ts', 'app/api/webhooks/hexacorp/route.ts', 'app/api/orders/[reference]/route.ts', 'app/api/admin/orders/reconcile/route.ts']) {
      expect(read(f), f).toMatch(/export const dynamic = 'force-dynamic'/);
    }
  });
});
