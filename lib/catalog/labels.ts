import type { Concentration, Family, VolumeId, Wear } from './types';

export const FAMILY_LABEL: Record<Family, string> = {
  floral: 'Floral',
  citrus: 'Citrus',
  green: 'Green',
  aquatic: 'Aquatic',
  woody: 'Woody & musk',
  amber: 'Amber & resin',
  gourmand: 'Gourmand',
};

export const FAMILY_BLURB: Record<Family, string> = {
  floral: 'White flowers and night blooms, from sheer to heady.',
  citrus: 'Bright peel, bitter zest and cold tonic water.',
  green: 'Cut leaves, resin and unripe fruit.',
  aquatic: 'Salt air, driftwood and a little sun.',
  woody: 'Dry woods, smoke and clean skin musk.',
  amber: 'Resins, incense and slow warmth.',
  gourmand: 'Coffee, cacao and soft vanilla.',
};

/** The colour of a family swatch (decorative; never carries meaning alone). */
export const FAMILY_HUE: Record<Family, string> = {
  floral: '#E7B7C0',
  citrus: '#EFC25A',
  green: '#9DB27A',
  aquatic: '#8FB6C4',
  woody: '#A98B6B',
  amber: '#C9772F',
  gourmand: '#7A4B34',
};

export const CONCENTRATION_LABEL: Record<Concentration, string> = {
  cologne: 'Cologne',
  'eau-de-toilette': 'Eau de toilette',
  'eau-de-parfum': 'Eau de parfum',
  extrait: 'Extrait de parfum',
};

export const WEAR_LABEL: Record<Wear, string> = {
  'for-her': 'For her',
  'for-him': 'For him',
  shared: 'Shared',
};

export const VOLUME_LABEL: Record<VolumeId, string> = {
  '10ml': '10 ml travel',
  '30ml': '30 ml',
  '50ml': '50 ml',
  '100ml': '100 ml',
};
