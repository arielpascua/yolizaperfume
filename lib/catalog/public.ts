// The ONLY shape public components accept. It is built field by field, so a price or tier
// can never ride along by accident.

import { FRAGRANCES, VOLUMES } from './data';
import type { Fragrance, PublicFragrance } from './types';

export function toPublicFragrance(f: Fragrance): PublicFragrance {
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    tagline: f.tagline,
    family: f.family,
    concentration: f.concentration,
    wear: f.wear,
    notes: { top: [...f.notes.top], heart: [...f.notes.heart], base: [...f.notes.base] },
    story: [...f.story],
    volumes: f.volumes.map((id) => ({ ...VOLUMES[id] })),
    bottle: { ...f.bottle },
    inStock: f.inStock,
  };
}

export function listPublicFragrances(): PublicFragrance[] {
  return FRAGRANCES.map(toPublicFragrance);
}

export function getPublicFragrance(slug: string): PublicFragrance | null {
  const f = FRAGRANCES.find((x) => x.slug === slug);
  return f ? toPublicFragrance(f) : null;
}

/** Up to `count` other fragrances, same family first. */
export function relatedFragrances(slug: string, count = 3): PublicFragrance[] {
  const all = listPublicFragrances();
  const self = all.find((f) => f.slug === slug);
  const others = all.filter((f) => f.slug !== slug);
  if (!self) return others.slice(0, count);
  const sameFamily = others.filter((f) => f.family === self.family);
  const rest = others.filter((f) => f.family !== self.family);
  return [...sameFamily, ...rest].slice(0, count);
}
