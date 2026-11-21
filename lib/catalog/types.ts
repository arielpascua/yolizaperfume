// The catalogue's vocabulary. A fragrance is one scent in one concentration; the only
// variant is the bottle volume. Wholesale orders are placed in CASES of a fixed pack size.

export const FAMILIES = ['floral', 'citrus', 'green', 'aquatic', 'woody', 'amber', 'gourmand'] as const;
export const CONCENTRATIONS = ['cologne', 'eau-de-toilette', 'eau-de-parfum', 'extrait'] as const;
export const WEARS = ['for-her', 'for-him', 'shared'] as const;
export const VOLUME_IDS = ['10ml', '30ml', '50ml', '100ml'] as const;
export const TIERS = ['signature', 'reserve'] as const;
export const BOTTLE_SHAPES = ['flacon', 'sphere', 'column', 'facet', 'arch', 'drop'] as const;
export const CAP_FINISHES = ['gold', 'noir', 'wood', 'silver'] as const;

export type Family = (typeof FAMILIES)[number];
export type Concentration = (typeof CONCENTRATIONS)[number];
export type Wear = (typeof WEARS)[number];
export type VolumeId = (typeof VOLUME_IDS)[number];
export type Tier = (typeof TIERS)[number];
export type BottleShape = (typeof BOTTLE_SHAPES)[number];
export type CapFinish = (typeof CAP_FINISHES)[number];

export interface Notes {
  top: string[];
  heart: string[];
  base: string[];
}

export interface Bottle {
  shape: BottleShape;
  /** The liquid colour, a hex string. */
  liquid: string;
  cap: CapFinish;
}

/** The priced catalogue record. Server-side only: it carries `tier`, which decides the price. */
export interface Fragrance {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  family: Family;
  concentration: Concentration;
  wear: Wear;
  notes: Notes;
  story: string[];
  volumes: VolumeId[];
  tier: Tier;
  bottle: Bottle;
  inStock: boolean;
}

export interface PublicVolume {
  id: VolumeId;
  label: string;
  ml: number;
  /** Bottles in one case. Orders are placed in whole cases. */
  casePack: number;
}

/** The ONLY fragrance shape a public component accepts. It has no price and no tier. */
export interface PublicFragrance {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  family: Family;
  concentration: Concentration;
  wear: Wear;
  notes: Notes;
  story: string[];
  volumes: PublicVolume[];
  bottle: Bottle;
  inStock: boolean;
}
