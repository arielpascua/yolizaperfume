import { describe, expect, it } from 'vitest';
import { CheckoutError } from '@/lib/checkout/parse';
import { parseEnquiry } from './parse';

const valid = () => ({
  company: 'Casa Bella',
  contactName: 'Ana Reyes',
  email: 'ana@casabella.example',
  businessType: 'boutique',
  wantsSamples: true,
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

describe('parseEnquiry', () => {
  it('accepts a complete enquiry', () => {
    const e = parseEnquiry(valid());
    expect(e.businessType).toBe('boutique');
    expect(e.wantsSamples).toBe(true);
    expect(e.lines).toHaveLength(1);
  });

  it('accepts an open application with no fragrances', () => {
    expect(parseEnquiry({ ...valid(), items: undefined }).lines).toEqual([]);
    expect(parseEnquiry({ ...valid(), items: [] }).lines).toEqual([]);
  });

  it('requires company, contact, a valid email and a known business type', () => {
    expect(status(() => parseEnquiry({ ...valid(), company: '' }))).toBe(400);
    expect(status(() => parseEnquiry({ ...valid(), contactName: '' }))).toBe(400);
    expect(status(() => parseEnquiry({ ...valid(), email: 'x' }))).toBe(400);
    expect(status(() => parseEnquiry({ ...valid(), businessType: 'spaceship' }))).toBe(400);
    expect(status(() => parseEnquiry({ ...valid(), businessType: undefined }))).toBe(400);
  });

  it('rejects a filled honeypot', () => {
    expect(status(() => parseEnquiry({ ...valid(), website: 'x' }))).toBe(400);
  });

  it('keeps the shop address (storeWebsite) separate from the honeypot', () => {
    expect(parseEnquiry({ ...valid(), storeWebsite: 'casabella.example' }).storeWebsite).toBe('casabella.example');
  });

  it('rejects duplicate lines and bad case counts, and drops smuggled prices', () => {
    const line = { fragranceId: 'yz-01', volumeId: '50ml', cases: 1 };
    expect(status(() => parseEnquiry({ ...valid(), items: [line, line] }))).toBe(400);
    expect(status(() => parseEnquiry({ ...valid(), items: [{ ...line, cases: 0 }] }))).toBe(400);
    expect(status(() => parseEnquiry({ ...valid(), items: [{ ...line, cases: 2.5 }] }))).toBe(400);
    const [out] = parseEnquiry({ ...valid(), items: [{ ...line, price: 5 }] }).lines;
    expect(Object.keys(out).sort()).toEqual(['cases', 'fragranceId', 'volumeId']);
  });

  it('rejects a non-boolean samples flag and an over-long message', () => {
    expect(status(() => parseEnquiry({ ...valid(), wantsSamples: 'yes' }))).toBe(400);
    expect(status(() => parseEnquiry({ ...valid(), message: 'x'.repeat(2001) }))).toBe(400);
  });

  it('allows line breaks in the message but not in the company', () => {
    expect(parseEnquiry({ ...valid(), message: 'a\nb' }).message).toBe('a\nb');
    expect(status(() => parseEnquiry({ ...valid(), company: 'a\nb' }))).toBe(400);
  });
});
