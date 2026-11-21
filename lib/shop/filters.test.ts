import { describe, expect, it } from 'vitest';
import { listPublicFragrances } from '@/lib/catalog/public';
import { applyFilters, collectionHref, parseFilters } from './filters';

const all = listPublicFragrances();

describe('parseFilters', () => {
  it('keeps known values and drops unknown ones', () => {
    expect(parseFilters({ family: 'floral', wear: 'for-her', concentration: 'extrait' })).toEqual({
      family: 'floral', wear: 'for-her', concentration: 'extrait',
    });
    expect(parseFilters({ family: 'nonsense', wear: ['for-him', 'x'], concentration: '' })).toEqual({ wear: 'for-him' });
  });

  it('trims and caps the search text, and ignores it when blank', () => {
    expect(parseFilters({ q: '  amber  ' }).q).toBe('amber');
    expect(parseFilters({ q: 'x'.repeat(200) }).q).toHaveLength(60);
    expect(parseFilters({ q: '   ' })).toEqual({});
  });
});

describe('applyFilters', () => {
  it('filters by family, wear and concentration together', () => {
    const r = applyFilters(all, { family: 'floral', wear: 'for-her' });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((f) => f.family === 'floral' && f.wear === 'for-her')).toBe(true);
    expect(applyFilters(all, { concentration: 'extrait' }).every((f) => f.concentration === 'extrait')).toBe(true);
  });

  it('searches names, taglines and every note level, case-insensitively', () => {
    expect(applyFilters(all, { q: 'VETIVER' }).map((f) => f.slug)).toContain('mayon-ash');
    expect(applyFilters(all, { q: 'sampaguita' }).length).toBeGreaterThan(0);
    expect(applyFilters(all, { q: 'zzzzzz' })).toEqual([]);
  });

  it('returns everything with no filters', () => {
    expect(applyFilters(all, {})).toHaveLength(all.length);
  });
});

describe('collectionHref', () => {
  it('round-trips through parseFilters', () => {
    const f = { family: 'woody', wear: 'shared', q: 'smoke & ash' } as const;
    const url = new URL(collectionHref(f), 'http://x');
    expect(parseFilters(Object.fromEntries(url.searchParams))).toEqual(f);
    expect(collectionHref({})).toBe('/collection');
  });
});
