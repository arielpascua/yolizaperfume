import { CONCENTRATIONS, FAMILIES, WEARS } from '@/lib/catalog/types';
import type { Concentration, Family, PublicFragrance, Wear } from '@/lib/catalog/types';

export interface Filters {
  family?: Family;
  wear?: Wear;
  concentration?: Concentration;
  q?: string;
}

type Raw = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function pick<T extends string>(allowed: readonly T[], v: string | undefined): T | undefined {
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Reads filters from URL search params. Unknown values are dropped, never trusted. */
export function parseFilters(raw: Raw): Filters {
  const q = one(raw.q)?.trim().slice(0, 60);
  return {
    family: pick(FAMILIES, one(raw.family)),
    wear: pick(WEARS, one(raw.wear)),
    concentration: pick(CONCENTRATIONS, one(raw.concentration)),
    ...(q ? { q } : {}),
  };
}

const norm = (s: string) => s.toLowerCase();

export function applyFilters(list: PublicFragrance[], f: Filters): PublicFragrance[] {
  const q = f.q ? norm(f.q) : '';
  return list.filter((x) => {
    if (f.family && x.family !== f.family) return false;
    if (f.wear && x.wear !== f.wear) return false;
    if (f.concentration && x.concentration !== f.concentration) return false;
    if (q) {
      const hay = [x.name, x.tagline, ...x.notes.top, ...x.notes.heart, ...x.notes.base].map(norm).join(' | ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** A /collection URL for the given filters. */
export function collectionHref(f: Filters): string {
  const p = new URLSearchParams();
  if (f.family) p.set('family', f.family);
  if (f.wear) p.set('wear', f.wear);
  if (f.concentration) p.set('concentration', f.concentration);
  if (f.q) p.set('q', f.q);
  const qs = p.toString();
  return qs ? `/collection?${qs}` : '/collection';
}
