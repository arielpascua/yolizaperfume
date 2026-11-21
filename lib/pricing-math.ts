// Price ARITHMETIC with no price DATA in it, so the checkout page can show a live total without
// shipping the whole price table to the browser. The authority is still the server: /api/checkout
// recomputes everything from ids and case counts through lib/pricing.ts and ignores the browser.
//
// Only the order page and the order API may import this (test/b2b-guard.test.ts enforces that).

/** Whole cases across the whole order → a discount on the merchandise subtotal. Highest matching row wins. */
export const VOLUME_BREAKS: readonly { minCases: number; percent: number }[] = [
  { minCases: 0, percent: 0 },
  { minCases: 10, percent: 5 },
  { minCases: 25, percent: 10 },
  { minCases: 60, percent: 15 },
];

export const MIN_ORDER_PESOS = 20_000;
export const MAX_CASES_PER_LINE = 200;
export const MAX_LINES = 40;

export function discountPercentFor(totalCases: number): number {
  let percent = 0;
  for (const row of VOLUME_BREAKS) if (totalCases >= row.minCases) percent = row.percent;
  return percent;
}

export interface PricedInput {
  cases: number;
  casePack: number;
  unitPrice: number;
}

export interface Totals {
  totalCases: number;
  totalBottles: number;
  subtotal: number;
  discountPercent: number;
  discount: number;
  total: number;
  minimumOrder: number;
  meetsMinimum: boolean;
}

export function totalsFor(
  lines: readonly PricedInput[],
  minimum: number = MIN_ORDER_PESOS,
  /** False for a flat-price item (the test item): no volume discount at any quantity. */
  discounts: boolean = true,
): Totals {
  const totalCases = lines.reduce((n, l) => n + l.cases, 0);
  const totalBottles = lines.reduce((n, l) => n + l.cases * l.casePack, 0);
  const subtotal = lines.reduce((n, l) => n + l.cases * l.casePack * l.unitPrice, 0);
  const discountPercent = discounts ? discountPercentFor(totalCases) : 0;
  const discount = Math.round((subtotal * discountPercent) / 100);
  const total = subtotal - discount;
  return {
    totalCases,
    totalBottles,
    subtotal,
    discountPercent,
    discount,
    total,
    minimumOrder: minimum,
    meetsMinimum: total >= minimum,
  };
}
