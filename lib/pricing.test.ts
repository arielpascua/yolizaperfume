import { describe, expect, it } from 'vitest';
import { FRAGRANCES, VOLUMES } from '@/lib/catalog/data';
import { MIN_ORDER_PESOS, QuoteError, TEST_ITEM_ID, UNIT_PRICE, discountPercentFor, minimumOrderPesos, orderableCatalogue, quote, testItemOnly } from './pricing';
import { totalsFor } from './pricing-math';

const SIG = FRAGRANCES.find((f) => f.tier === 'signature' && f.inStock && f.volumes.includes('50ml'))!;
const RES = FRAGRANCES.find((f) => f.tier === 'reserve')!;

describe('quote', () => {
  it('prices a line as cases x case pack x unit price', () => {
    const q = quote([{ fragranceId: SIG.id, volumeId: '50ml', cases: 3 }]);
    expect(q.lines[0]).toMatchObject({ cases: 3, casePack: VOLUMES['50ml'].casePack, bottles: 36, unitPrice: UNIT_PRICE.signature['50ml'] });
    expect(q.subtotal).toBe(36 * UNIT_PRICE.signature['50ml']);
    expect(q.total).toBe(q.subtotal);
  });

  it('prices reserve fragrances on the reserve table', () => {
    const q = quote([{ fragranceId: RES.id, volumeId: '30ml', cases: 1 }]);
    expect(q.lines[0].unitPrice).toBe(UNIT_PRICE.reserve['30ml']);
    expect(q.lines[0].unitPrice).toBeGreaterThan(UNIT_PRICE.signature['30ml']);
  });

  it('applies the volume discount across the whole order, by total cases', () => {
    const q = quote([
      { fragranceId: SIG.id, volumeId: '50ml', cases: 6 },
      { fragranceId: RES.id, volumeId: '50ml', cases: 5 },
    ]);
    expect(q.totalCases).toBe(11);
    expect(q.discountPercent).toBe(5);
    expect(q.discount).toBe(Math.round((q.subtotal * 5) / 100));
    expect(q.total).toBe(q.subtotal - q.discount);
  });

  it('rejects an unknown fragrance, an unoffered volume and an out-of-stock fragrance', () => {
    expect(() => quote([{ fragranceId: 'nope', volumeId: '50ml', cases: 1 }])).toThrow(QuoteError);
    const only3 = FRAGRANCES.find((f) => !f.volumes.includes('10ml'))!;
    expect(() => quote([{ fragranceId: only3.id, volumeId: '10ml', cases: 1 }])).toThrow(QuoteError);
    const oos = FRAGRANCES.find((f) => !f.inStock)!;
    expect(() => quote([{ fragranceId: oos.id, volumeId: oos.volumes[0], cases: 1 }])).toThrow(/out of stock/);
  });

  it('flags an order under the minimum', () => {
    const small = quote([{ fragranceId: SIG.id, volumeId: '10ml', cases: 1 }]);
    expect(small.total).toBeLessThan(MIN_ORDER_PESOS);
    expect(small.meetsMinimum).toBe(false);
    const big = quote([{ fragranceId: SIG.id, volumeId: '50ml', cases: 5 }]);
    expect(big.meetsMinimum).toBe(true);
  });

  it('never reads a price from the request: extra fields are ignored', () => {
    const tampered = [{ fragranceId: SIG.id, volumeId: '50ml', cases: 2, unitPrice: 1, price: 1, lineTotal: 1 }];
    const q = quote(tampered);
    expect(q.lines[0].unitPrice).toBe(UNIT_PRICE.signature['50ml']);
  });
});

describe('discount breaks', () => {
  it.each([[1, 0], [9, 0], [10, 5], [24, 5], [25, 10], [59, 10], [60, 15], [500, 15]])('%i cases -> %i%%', (cases, pct) => {
    expect(discountPercentFor(cases)).toBe(pct);
  });
});

describe('price table', () => {
  it('has a positive whole-peso price for every volume of both tiers, rising with volume', () => {
    for (const tier of ['signature', 'reserve'] as const) {
      const row = UNIT_PRICE[tier];
      const order = ['10ml', '30ml', '50ml', '100ml'] as const;
      for (const v of order) expect(Number.isInteger(row[v]) && row[v] > 0).toBe(true);
      for (let i = 1; i < order.length; i++) expect(row[order[i]]).toBeGreaterThan(row[order[i - 1]]);
    }
  });

  it('orderableCatalogue lists only in-stock fragrances, with prices', () => {
    const list = orderableCatalogue();
    expect(list.length).toBe(FRAGRANCES.filter((f) => f.inStock).length);
    expect(list.every((f) => f.volumes.every((v) => v.unitPrice > 0))).toBe(true);
    expect(list.find((f) => f.name === 'Tsokolate Tablea')).toBeUndefined();
  });
});

describe('totalsFor (client arithmetic) agrees with the server quote', () => {
  it('gives the same totals for the same basket', () => {
    const basket = [
      { fragranceId: SIG.id, volumeId: '50ml', cases: 7 },
      { fragranceId: RES.id, volumeId: '30ml', cases: 4 },
    ];
    const server = quote(basket);
    const client = totalsFor(server.lines.map((l) => ({ cases: l.cases, casePack: l.casePack, unitPrice: l.unitPrice })));
    expect(client.total).toBe(server.total);
    expect(client.discount).toBe(server.discount);
    expect(client.totalBottles).toBe(server.totalBottles);
  });
});

describe('test mode (CHECKOUT_TEST_ITEM=1)', () => {
  const ON = { CHECKOUT_TEST_ITEM: '1' };

  it('offers only the PHP 10 test item and lowers the minimum to match', () => {
    const list = orderableCatalogue(ON);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: TEST_ITEM_ID, name: 'Test item' });
    expect(list[0].volumes).toEqual([{ id: '10ml', label: 'Test unit', casePack: 1, unitPrice: 10 }]);
    expect(testItemOnly(ON)).toBe(true);
    expect(minimumOrderPesos(ON)).toBe(10);
  });

  it('prices it at PHP 10 a unit with no discount, and meets the lowered minimum', () => {
    const q = quote([{ fragranceId: TEST_ITEM_ID, volumeId: '10ml', cases: 1 }], ON);
    expect(q).toMatchObject({ subtotal: 10, discount: 0, total: 10, totalBottles: 1, minimumOrder: 10, meetsMinimum: true });
    // flat PHP 10 at ANY quantity: the volume discount (5%, 10%, 15%) never applies to the test item
    for (const n of [9, 10, 25, 60, 200]) {
      const big = quote([{ fragranceId: TEST_ITEM_ID, volumeId: '10ml', cases: n }], ON);
      expect(big, String(n)).toMatchObject({ total: n * 10, discount: 0, discountPercent: 0 });
    }
  });

  it('refuses everything else while on', () => {
    expect(() => quote([{ fragranceId: SIG.id, volumeId: '50ml', cases: 5 }], ON)).toThrow(/only the test item/i);
    expect(() => quote([{ fragranceId: TEST_ITEM_ID, volumeId: '50ml', cases: 1 }], ON)).toThrow(QuoteError);
  });

  it('does not exist when off: the real catalogue, the real minimum, an unknown test id', () => {
    for (const off of [{}, { CHECKOUT_TEST_ITEM: '' }, { CHECKOUT_TEST_ITEM: '0' }, { CHECKOUT_TEST_ITEM: 'true' }]) {
      expect(testItemOnly(off)).toBe(false);
      expect(minimumOrderPesos(off)).toBe(MIN_ORDER_PESOS);
      expect(orderableCatalogue(off).some((f) => f.id === TEST_ITEM_ID)).toBe(false);
      expect(() => quote([{ fragranceId: TEST_ITEM_ID, volumeId: '10ml', cases: 1 }], off)).toThrow(/no longer listed/);
    }
  });
});
