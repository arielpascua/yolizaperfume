import { describe, expect, it } from 'vitest';
import { FRAGRANCES, VOLUMES } from './data';
import { getPublicFragrance, listPublicFragrances, relatedFragrances, toPublicFragrance } from './public';
import { FAMILIES } from './types';

describe('catalogue integrity', () => {
  it('has unique ids and slugs, and url-safe slugs', () => {
    expect(new Set(FRAGRANCES.map((f) => f.id)).size).toBe(FRAGRANCES.length);
    expect(new Set(FRAGRANCES.map((f) => f.slug)).size).toBe(FRAGRANCES.length);
    for (const f of FRAGRANCES) expect(f.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('gives every fragrance notes at every level, a story, a tagline and at least one volume', () => {
    for (const f of FRAGRANCES) {
      expect(f.notes.top.length).toBeGreaterThan(0);
      expect(f.notes.heart.length).toBeGreaterThan(0);
      expect(f.notes.base.length).toBeGreaterThan(0);
      expect(f.story.length).toBeGreaterThan(0);
      expect(f.tagline.length).toBeGreaterThan(10);
      expect(f.volumes.length).toBeGreaterThan(0);
      expect(new Set(f.volumes).size).toBe(f.volumes.length);
      expect(f.bottle.liquid).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('uses every family at least once', () => {
    for (const fam of FAMILIES) expect(FRAGRANCES.some((f) => f.family === fam)).toBe(true);
  });

  it('keeps at least one fragrance in stock to order', () => {
    expect(FRAGRANCES.some((f) => f.inStock)).toBe(true);
  });

  it('has a sane case pack for every volume', () => {
    for (const v of Object.values(VOLUMES)) {
      expect(Number.isInteger(v.casePack) && v.casePack >= 6 && v.casePack <= 24).toBe(true);
    }
  });
});

describe('public shape', () => {
  it('carries no price, no tier and no case price anywhere', () => {
    const json = JSON.stringify(listPublicFragrances());
    expect(json).not.toMatch(/price|tier|unitPrice|peso|₱/i);
    for (const f of listPublicFragrances()) {
      expect(Object.keys(f).sort()).toEqual(
        ['bottle', 'concentration', 'family', 'id', 'inStock', 'name', 'notes', 'slug', 'story', 'tagline', 'volumes', 'wear'],
      );
      for (const v of f.volumes) expect(Object.keys(v).sort()).toEqual(['casePack', 'id', 'label', 'ml']);
    }
  });

  it('copies notes so a caller cannot mutate the catalogue', () => {
    const p = toPublicFragrance(FRAGRANCES[0]);
    p.notes.top.push('x');
    expect(FRAGRANCES[0].notes.top).not.toContain('x');
  });

  it('looks a fragrance up by slug and returns null for an unknown one', () => {
    expect(getPublicFragrance(FRAGRANCES[0].slug)?.name).toBe(FRAGRANCES[0].name);
    expect(getPublicFragrance('does-not-exist')).toBeNull();
  });

  it('suggests same-family fragrances first and never itself', () => {
    const slug = 'sampaguita-nocturne';
    const rel = relatedFragrances(slug, 3);
    expect(rel).toHaveLength(3);
    expect(rel.find((r) => r.slug === slug)).toBeUndefined();
    expect(rel[0].family).toBe('floral');
  });
});
