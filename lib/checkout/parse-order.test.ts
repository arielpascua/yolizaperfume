import { describe, expect, it } from 'vitest';
import { CheckoutError } from './parse';
import { parseLines, parseOrder } from './parse-order';

const valid = () => ({
  buyer: { company: 'Casa Bella', contactName: 'Ana Reyes', email: 'ana@casabella.example', phone: '+63 917 000 0000' },
  shipping: { line1: '1 Rizal St', city: 'Cebu City', postalCode: '6000', country: 'Philippines' },
  items: [{ fragranceId: 'yz-01', volumeId: '50ml', cases: 2 }],
});

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof CheckoutError ? e.status : -1;
  }
  return 0;
};

describe('parseOrder', () => {
  it('accepts a complete order and trims strings', () => {
    const body = valid();
    body.buyer.company = '  Casa Bella  ';
    const o = parseOrder(body);
    expect(o.buyer.company).toBe('Casa Bella');
    expect(o.lines).toEqual([{ fragranceId: 'yz-01', volumeId: '50ml', cases: 2 }]);
    expect(o.shipping.line2).toBe('');
  });

  it.each([
    ['no company', (b: ReturnType<typeof valid>) => { b.buyer.company = ''; }],
    ['bad email', (b: ReturnType<typeof valid>) => { b.buyer.email = 'nope'; }],
    ['no phone', (b: ReturnType<typeof valid>) => { b.buyer.phone = ''; }],
    ['no street', (b: ReturnType<typeof valid>) => { b.shipping.line1 = ''; }],
    ['no country', (b: ReturnType<typeof valid>) => { b.shipping.country = ''; }],
    ['no items', (b: ReturnType<typeof valid>) => { b.items = []; }],
  ])('rejects: %s', (_name, mutate) => {
    const body = valid();
    mutate(body);
    expect(status(() => parseOrder(body))).toBe(400);
  });

  it('rejects a filled honeypot and a non-object body', () => {
    expect(status(() => parseOrder({ ...valid(), website: 'http://spam.example' }))).toBe(400);
    expect(status(() => parseOrder('text'))).toBe(400);
    expect(status(() => parseOrder(null))).toBe(400);
    expect(status(() => parseOrder([]))).toBe(400);
  });

  it('rejects control and invisible characters in single-line fields', () => {
    const nul = String.fromCharCode(0);
    const lineSep = String.fromCharCode(0x2028);
    const rlo = String.fromCharCode(0x202e);
    for (const bad of ['a\nb', 'a\rb', `a${nul}b`, `a${lineSep}b`, `a${rlo}b`]) {
      const body = valid();
      body.buyer.contactName = bad;
      expect(status(() => parseOrder(body))).toBe(400);
    }
  });

  it('allows line breaks in the notes field only', () => {
    expect(parseOrder({ ...valid(), notes: 'Ring the bell\nGate B' }).notes).toBe('Ring the bell\nGate B');
    const nul = String.fromCharCode(0);
    expect(status(() => parseOrder({ ...valid(), notes: `x${nul}` }))).toBe(400);
  });

  it('caps field lengths', () => {
    const body = valid();
    body.buyer.company = 'x'.repeat(500);
    expect(status(() => parseOrder(body))).toBe(400);
  });
});

describe('parseLines', () => {
  it('rejects non-integer, zero, negative, string and oversized case counts', () => {
    for (const cases of [1.5, 0, -1, '2', 201, NaN, null]) {
      expect(status(() => parseLines([{ fragranceId: 'yz-01', volumeId: '50ml', cases }]))).toBe(400);
    }
  });

  it('merges a repeated fragrance and volume, but keeps the cap on the merged total', () => {
    const merged = parseLines([
      { fragranceId: 'yz-01', volumeId: '50ml', cases: 2 },
      { fragranceId: 'yz-01', volumeId: '50ml', cases: 3 },
      { fragranceId: 'yz-01', volumeId: '30ml', cases: 1 },
    ]);
    expect(merged).toEqual([
      { fragranceId: 'yz-01', volumeId: '50ml', cases: 5 },
      { fragranceId: 'yz-01', volumeId: '30ml', cases: 1 },
    ]);
    expect(
      status(() => parseLines([
        { fragranceId: 'yz-01', volumeId: '50ml', cases: 150 },
        { fragranceId: 'yz-01', volumeId: '50ml', cases: 150 },
      ])),
    ).toBe(400);
  });

  it('rebuilds each line from known fields only: a smuggled price is dropped', () => {
    const [line] = parseLines([{ fragranceId: 'yz-01', volumeId: '50ml', cases: 1, unitPrice: 1, price: 1 }]);
    expect(Object.keys(line).sort()).toEqual(['cases', 'fragranceId', 'volumeId']);
  });

  it('limits the number of lines', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ fragranceId: `id-${i}`, volumeId: '50ml', cases: 1 }));
    expect(status(() => parseLines(many))).toBe(400);
  });
});
