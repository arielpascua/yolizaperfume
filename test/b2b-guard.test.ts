// Standing source guards for the two promises this site makes:
//   1. Public pages show no price (no peso amount, no price table, no pricing import).
//   2. The ONE checkout is a single open route, /checkout, and the only place a price appears.

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

const sources = [...walk('app'), ...walk('components'), ...walk('lib')].filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f),
);

// Code that is allowed to know prices: the order page, the order API, the price modules and what they read.
const PRICED = [
  /^app\/checkout\//,
  /^app\/api\/checkout\//,
  /^components\/checkout\//,
  /^lib\/pricing(-math)?\.ts$/,
  /^lib\/format\.ts$/,
  /^lib\/checkout\//,
  /^lib\/server\//,
  /^lib\/payments\//, // the gateway client: it formats the order total for Hexacorp
  /^lib\/catalog\/data\.ts$/, // holds `tier`, never a peso amount
];
const isPriced = (f: string) => PRICED.some((re) => re.test(f));
const publicSources = sources.filter((f) => !isPriced(f));
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

describe('public pages show no price', () => {
  it('has public source to scan', () => {
    expect(publicSources.length).toBeGreaterThan(15);
  });

  it('public source never contains a peso sign, a price word or a currency call', () => {
    const offenders = publicSources.filter((f) => /₱|formatPeso|\bunitPrice\b|\bUNIT_PRICE\b|\bpesos?\b/i.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('public source never imports the price modules', () => {
    const offenders = publicSources.filter((f) => /from ['"](@\/lib\/pricing(-math)?|\.\.?\/pricing(-math)?)['"]/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('only the order page and order API import the price table', () => {
    const importers = sources.filter((f) => /from ['"]@\/lib\/pricing['"]/.test(read(f)));
    // parse-order.ts takes only the case/line limits (re-exported constants), never a price.
    expect(importers.sort()).toEqual(['app/api/checkout/route.ts', 'app/checkout/page.tsx', 'lib/checkout/parse-order.ts']);
  });

  it('public components only accept the PublicFragrance shape', () => {
    const offenders = sources
      .filter((f) => /^components\/(shop|ui|home|layout|enquiry)\//.test(f) || /^app\/(collection|fragrance|page|about|trade|enquiry)/.test(f))
      .filter((f) => /\bFragrance\b[^a-zA-Z]/.test(read(f).replace(/PublicFragrance/g, '').replace(/PickerFragrance/g, '')))
      .filter((f) => /import[^;]*\bFragrance\b[^;]*from/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('the checkout is ONE open route, /checkout, and the only place a price appears', () => {
  it('is exactly one page, with no dynamic segment: there is no /checkout/<anything>', () => {
    const pages = walk('app').filter((f) => /^app\/checkout\/.*page\.tsx$/.test(f));
    expect(pages).toEqual(['app/checkout/page.tsx']);
  });

  it('has no order link any more: no link module, no token, no signing secret anywhere', () => {
    expect(sources.filter((f) => /(^|\/)link\.ts$/.test(f))).toEqual([]);
    const offenders = sources.filter((f) => /verifyLink|signLink|CHECKOUT_LINK_SECRET|CHECKOUT_REVOKED_LINK_IDS/.test(read(f)));
    expect(offenders).toEqual([]);
    expect(read('.env.example')).not.toMatch(/CHECKOUT_LINK_SECRET|CHECKOUT_REVOKED_LINK_IDS/);
  });

  it('is the primary call to action in the navigation', () => {
    expect(read('components/layout/nav.ts')).toMatch(/ORDER_HREF\s*=\s*'\/checkout'/);
    expect(read('components/layout/Header.tsx')).toContain('ORDER_HREF');
  });

  it('is marked noindex and nofollow by its layout', () => {
    const layout = read('app/checkout/layout.tsx');
    expect(layout).toMatch(/index:\s*false/);
    expect(layout).toMatch(/follow:\s*false/);
  });

  it('is rendered per request, because test mode and the payment mode are read from the environment', () => {
    expect(read('app/checkout/page.tsx')).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('the API quotes BEFORE it spends a creation cap, and spends the cap BEFORE it files the order', () => {
    const route = read('app/api/checkout/route.ts');
    const quoted = route.indexOf('quote(order.lines)');
    const spent = route.indexOf('sourceOrderLimiter.allow(');
    const filed = route.indexOf('await recordOrder(');
    expect(quoted).toBeGreaterThan(-1);
    expect(spent).toBeGreaterThan(quoted);
    expect(filed).toBeGreaterThan(spent);
    // both a per-source and a GLOBAL cap: the global one cannot be spoofed
    expect(route).toMatch(/globalOrderLimiter\.allow\('all'\)/);
  });
});

describe('the test item', () => {
  it('is never in the public catalogue: it exists only in the pricing module, behind CHECKOUT_TEST_ITEM', () => {
    for (const f of ['lib/catalog/data.ts', 'lib/catalog/public.ts', 'lib/catalog/types.ts']) expect(read(f), f).not.toMatch(/yz-test|TEST_ITEM/);
    const pricing = read('lib/pricing.ts');
    expect(pricing).toMatch(/CHECKOUT_TEST_ITEM/);
    expect(sources.filter((f) => /yz-test/.test(read(f)))).toEqual(['lib/pricing.ts']);
  });
});
