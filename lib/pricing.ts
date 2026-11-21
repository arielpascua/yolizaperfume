// THE ONLY PRICE AUTHORITY. It holds the price table, and it is imported by the checkout page
// and /api/checkout and by nothing public (test/b2b-guard.test.ts enforces that).
//
// Orders are placed in whole CASES. A case holds `casePack` bottles of one fragrance in one
// volume. A unit price is the wholesale price of one bottle, in whole pesos, before freight
// and any applicable tax (both are confirmed on the invoice, never computed here).

import { FRAGRANCES, VOLUMES } from '@/lib/catalog/data';
import type { Fragrance, Tier, VolumeId } from '@/lib/catalog/types';
import { MIN_ORDER_PESOS, totalsFor, type Totals } from './pricing-math';

export { MAX_CASES_PER_LINE, MAX_LINES, MIN_ORDER_PESOS, VOLUME_BREAKS, discountPercentFor } from './pricing-math';

export const UNIT_PRICE: Record<Tier, Record<VolumeId, number>> = {
  signature: { '10ml': 290, '30ml': 620, '50ml': 880, '100ml': 1380 },
  reserve: { '10ml': 420, '30ml': 910, '50ml': 1290, '100ml': 1980 },
};

export interface PricedLine {
  fragranceId: string;
  fragranceName: string;
  volumeId: VolumeId;
  volumeLabel: string;
  cases: number;
  casePack: number;
  bottles: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Quote extends Totals {
  lines: PricedLine[];
}

export function unitPrice(f: Pick<Fragrance, 'tier'>, volumeId: VolumeId): number {
  return UNIT_PRICE[f.tier][volumeId];
}

export class QuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteError';
  }
}

export interface RequestedLine {
  fragranceId: string;
  volumeId: string;
  cases: number;
}

/**
 * TEST MODE. With CHECKOUT_TEST_ITEM=1 the ONLY thing that can be ordered is a single PHP 10 test
 * item, and the minimum order drops to match, so a live payment can be proven end to end for ten
 * pesos instead of the real minimum. Remove the variable and the real catalogue is back, with no
 * code change. The test item is not in the public catalogue and cannot be ordered unless the
 * variable is set: outside test mode its id is simply unknown to `quote`.
 */
export const TEST_ITEM_ID = 'yz-test';
export const TEST_ITEM_UNIT_PESOS = 10;
const TEST_ITEM_VOLUME: VolumeId = '10ml';
const TEST_ITEM_LABEL = 'Test unit';

type Env = Record<string, string | undefined>;

export function testItemOnly(env: Env = process.env): boolean {
  return env.CHECKOUT_TEST_ITEM?.trim() === '1';
}

/** The minimum order in force: the real one, or the test item's price in test mode. */
export function minimumOrderPesos(env: Env = process.env): number {
  return testItemOnly(env) ? TEST_ITEM_UNIT_PESOS : MIN_ORDER_PESOS;
}

/**
 * Prices a basket from ids and case counts alone. This function takes no price, so anything a
 * caller claims about price is never read. Throws QuoteError for an unknown, unoffered or
 * out-of-stock item, and, in test mode, for anything but the test item.
 */
export function quote(requested: readonly RequestedLine[], env: Env = process.env): Quote {
  const testMode = testItemOnly(env);
  const lines: PricedLine[] = requested.map((r) => {
    if (testMode) {
      if (r.fragranceId !== TEST_ITEM_ID || r.volumeId !== TEST_ITEM_VOLUME) {
        throw new QuoteError('Only the test item can be ordered right now. Please reload the page.');
      }
      return {
        fragranceId: TEST_ITEM_ID,
        fragranceName: 'Test item',
        volumeId: TEST_ITEM_VOLUME,
        volumeLabel: TEST_ITEM_LABEL,
        cases: r.cases,
        casePack: 1,
        bottles: r.cases,
        unitPrice: TEST_ITEM_UNIT_PESOS,
        lineTotal: r.cases * TEST_ITEM_UNIT_PESOS,
      };
    }
    const f = FRAGRANCES.find((x) => x.id === r.fragranceId);
    if (!f) throw new QuoteError('One of the fragrances in your order is no longer listed. Please reload the page.');
    const volume = f.volumes.find((v) => v === r.volumeId);
    if (!volume) throw new QuoteError(`${f.name} is not offered in the volume you chose. Please reload the page.`);
    if (!f.inStock) throw new QuoteError(`${f.name} is out of stock. Please remove it from your order.`);
    const { casePack, label } = VOLUMES[volume];
    const price = unitPrice(f, volume);
    const bottles = r.cases * casePack;
    return {
      fragranceId: f.id,
      fragranceName: f.name,
      volumeId: volume,
      volumeLabel: label,
      cases: r.cases,
      casePack,
      bottles,
      unitPrice: price,
      lineTotal: bottles * price,
    };
  });
  // The test item is a flat PHP 10: no volume discount at any quantity.
  return { lines, ...totalsFor(lines, minimumOrderPesos(env), !testMode) };
}

/** What the order page shows: every orderable fragrance with its volumes and unit prices. */
export interface OrderableFragrance {
  id: string;
  name: string;
  family: string;
  volumes: { id: VolumeId; label: string; casePack: number; unitPrice: number }[];
}

export function orderableCatalogue(env: Env = process.env): OrderableFragrance[] {
  if (testItemOnly(env)) {
    return [
      {
        id: TEST_ITEM_ID,
        name: 'Test item',
        family: 'test',
        volumes: [{ id: TEST_ITEM_VOLUME, label: TEST_ITEM_LABEL, casePack: 1, unitPrice: TEST_ITEM_UNIT_PESOS }],
      },
    ];
  }
  return FRAGRANCES.filter((f) => f.inStock).map((f) => ({
    id: f.id,
    name: f.name,
    family: f.family,
    volumes: f.volumes.map((v) => ({ id: v, label: VOLUMES[v].label, casePack: VOLUMES[v].casePack, unitPrice: unitPrice(f, v) })),
  }));
}
