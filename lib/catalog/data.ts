// Launch catalogue. THE OWNER MUST CONFIRM every fragrance, note list, pack size and price
// against real stock before real orders are taken. No ratings, reviews, comparison prices or
// performance claims (longevity, sillage) exist here, on purpose: nothing here can be verified.

import type { Fragrance, PublicVolume, VolumeId } from './types';

export const VOLUMES: Record<VolumeId, PublicVolume> = {
  '10ml': { id: '10ml', label: '10 ml travel', ml: 10, casePack: 24 },
  '30ml': { id: '30ml', label: '30 ml', ml: 30, casePack: 12 },
  '50ml': { id: '50ml', label: '50 ml', ml: 50, casePack: 12 },
  '100ml': { id: '100ml', label: '100 ml', ml: 100, casePack: 6 },
};

const ALL: VolumeId[] = ['10ml', '30ml', '50ml', '100ml'];
const MID: VolumeId[] = ['30ml', '50ml', '100ml'];

export const FRAGRANCES: Fragrance[] = [
  {
    id: 'yz-01', slug: 'sampaguita-nocturne', name: 'Sampaguita Nocturne',
    tagline: 'Jasmine sambac after dark, softened with white musk.',
    family: 'floral', concentration: 'eau-de-parfum', wear: 'for-her', tier: 'signature', volumes: ALL, inStock: true,
    notes: { top: ['Bergamot', 'Green mandarin'], heart: ['Sampaguita', 'Tuberose'], base: ['White musk', 'Sandalwood'] },
    story: [
      'Sampaguita is the flower people thread into garlands and leave at doorways. Nocturne keeps that freshness and turns the light down.',
      'A clean, creamy white floral that sits well beside both modern and traditional counters.',
    ],
    bottle: { shape: 'flacon', liquid: '#F1DDB0', cap: 'gold' },
  },
  {
    id: 'yz-02', slug: 'dalandan-sol', name: 'Dalandan Sol',
    tagline: 'Sweet-sour orange peel in a bright, easy cologne.',
    family: 'citrus', concentration: 'cologne', wear: 'shared', tier: 'signature', volumes: ALL, inStock: true,
    notes: { top: ['Dalandan', 'Lemon zest', 'Pink pepper'], heart: ['Neroli', 'Petitgrain'], base: ['Cedar', 'Musk'] },
    story: [
      'The green-skinned local orange, sharp and juicy, set against neroli and a whisper of pepper.',
      'A light cologne concentration that suits spas, hotel amenities and first-time fragrance buyers.',
    ],
    bottle: { shape: 'sphere', liquid: '#F2A33B', cap: 'wood' },
  },
  {
    id: 'yz-03', slug: 'barako-smoke', name: 'Barako Smoke',
    tagline: 'Dark-roast coffee, tobacco leaf and warm vanilla.',
    family: 'gourmand', concentration: 'eau-de-parfum', wear: 'for-him', tier: 'signature', volumes: MID, inStock: true,
    notes: { top: ['Cardamom', 'Black pepper'], heart: ['Roasted coffee', 'Tobacco leaf'], base: ['Vanilla', 'Tonka', 'Cedar'] },
    story: [
      'Named for the strong, thick-bodied coffee of the highlands. Bitter first, then sweet, then smoke.',
      'An evening scent with a grown-up edge, built to sit on the gifting shelf as easily as the main counter.',
    ],
    bottle: { shape: 'column', liquid: '#5A3A24', cap: 'noir' },
  },
  {
    id: 'yz-04', slug: 'ilang-ilang-dusk', name: 'Ilang-Ilang Dusk',
    tagline: 'Ylang-ylang and rose melting into amber.',
    family: 'floral', concentration: 'eau-de-parfum', wear: 'for-her', tier: 'signature', volumes: ALL, inStock: true,
    notes: { top: ['Mandarin', 'Ginger'], heart: ['Ylang-ylang', 'Rose'], base: ['Amber', 'Vanilla'] },
    story: [
      'Ylang-ylang at its most generous, rounded by rose and held on a base of warm amber.',
      'A rich floral for customers who want something that gets noticed.',
    ],
    bottle: { shape: 'arch', liquid: '#E39AA0', cap: 'gold' },
  },
  {
    id: 'yz-05', slug: 'salt-and-siargao', name: 'Salt & Siargao',
    tagline: 'Sea salt, grapefruit and sun-bleached driftwood.',
    family: 'aquatic', concentration: 'eau-de-toilette', wear: 'shared', tier: 'signature', volumes: ALL, inStock: true,
    notes: { top: ['Sea salt', 'Grapefruit'], heart: ['Sea breeze accord', 'Coconut water'], base: ['Driftwood', 'Ambergris accord'] },
    story: [
      'An island afternoon: salt on the skin, cold grapefruit, a plank of weathered wood.',
      'Easy to sell, easy to wear, and a natural fit for resorts, surf shops and travel retail.',
    ],
    bottle: { shape: 'facet', liquid: '#86C2D0', cap: 'silver' },
  },
  {
    id: 'yz-06', slug: 'calamansi-tonic', name: 'Calamansi Tonic',
    tagline: 'Calamansi, yuzu and cold tonic water over white tea.',
    family: 'citrus', concentration: 'cologne', wear: 'shared', tier: 'signature', volumes: ALL, inStock: true,
    notes: { top: ['Calamansi', 'Yuzu', 'Tonic water'], heart: ['Basil', 'White tea'], base: ['Vetiver', 'Musk'] },
    story: [
      'Small sour limes squeezed over ice. Crisp, a little bitter, and gone in the nicest way.',
    ],
    bottle: { shape: 'drop', liquid: '#C8D96A', cap: 'silver' },
  },
  {
    id: 'yz-07', slug: 'narra-oud', name: 'Narra Oud',
    tagline: 'Saffron, oud and leather around a narra-wood accord.',
    family: 'woody', concentration: 'extrait', wear: 'shared', tier: 'reserve', volumes: MID, inStock: true,
    notes: { top: ['Saffron', 'Cinnamon'], heart: ['Narra wood accord', 'Oud'], base: ['Leather', 'Labdanum', 'Amber'] },
    story: [
      'The deepest bottle in the house. Resinous, dry and leathery, in extrait concentration.',
      'A reserve fragrance for counters that sell on character rather than volume.',
    ],
    bottle: { shape: 'column', liquid: '#6B2B22', cap: 'gold' },
  },
  {
    id: 'yz-08', slug: 'tabon-amber', name: 'Tabon Amber',
    tagline: 'Incense, myrrh and rose over slow-burning amber.',
    family: 'amber', concentration: 'eau-de-parfum', wear: 'shared', tier: 'signature', volumes: MID, inStock: true,
    notes: { top: ['Pink pepper', 'Bergamot'], heart: ['Incense', 'Myrrh', 'Rose'], base: ['Amber', 'Benzoin', 'Vanilla'] },
    story: [
      'Warm, resinous and quiet. A cool-weather staple and a reliable repeat order.',
    ],
    bottle: { shape: 'flacon', liquid: '#C77A2A', cap: 'noir' },
  },
  {
    id: 'yz-09', slug: 'banig-musk', name: 'Banig Musk',
    tagline: 'Pear, cotton and woven-straw warmth on clean musk.',
    family: 'woody', concentration: 'eau-de-parfum', wear: 'shared', tier: 'signature', volumes: ALL, inStock: true,
    notes: { top: ['Pear', 'Cotton flower'], heart: ['Straw accord', 'Iris'], base: ['White musk', 'Cashmeran'] },
    story: [
      'The smell of a freshly laid sleeping mat: dry grass, clean linen, skin.',
      'A soft, close scent that is easy to recommend across the whole counter.',
    ],
    bottle: { shape: 'arch', liquid: '#E6DABD', cap: 'wood' },
  },
  {
    id: 'yz-10', slug: 'dama-de-noche', name: 'Dama de Noche',
    tagline: 'Night-blooming jasmine, tuberose and patchouli.',
    family: 'floral', concentration: 'extrait', wear: 'for-her', tier: 'reserve', volumes: MID, inStock: true,
    notes: { top: ['Blackcurrant', 'Pink pepper'], heart: ['Night jasmine', 'Tuberose', 'Ylang-ylang'], base: ['Patchouli', 'Vanilla', 'Musk'] },
    story: [
      'The lady of the night opens after sundown. This is that hour, in extrait strength.',
      'A heady white floral for the top shelf.',
    ],
    bottle: { shape: 'facet', liquid: '#B9879E', cap: 'gold' },
  },
  {
    id: 'yz-11', slug: 'mayon-ash', name: 'Mayon Ash',
    tagline: 'Vetiver, black pepper and a drift of volcanic smoke.',
    family: 'woody', concentration: 'eau-de-parfum', wear: 'for-him', tier: 'signature', volumes: MID, inStock: true,
    notes: { top: ['Grapefruit', 'Elemi'], heart: ['Vetiver', 'Black pepper', 'Ash accord'], base: ['Patchouli', 'Cedar', 'Incense'] },
    story: [
      'Dry, grey-green and smoky. A woody for customers who find most masculines too sweet.',
    ],
    bottle: { shape: 'column', liquid: '#8D8F86', cap: 'noir' },
  },
  {
    id: 'yz-12', slug: 'pili-resin', name: 'Pili Resin',
    tagline: 'Elemi resin and green fig leaf, sharp and clean.',
    family: 'green', concentration: 'eau-de-parfum', wear: 'shared', tier: 'signature', volumes: MID, inStock: true,
    notes: { top: ['Elemi', 'Lemon'], heart: ['Fig leaf', 'Green tea'], base: ['Cedar', 'Moss', 'Musk'] },
    story: [
      'Pili trees weep a lemony, peppery resin. We kept it bright and gave it a leafy backdrop.',
    ],
    bottle: { shape: 'flacon', liquid: '#9BB06A', cap: 'wood' },
  },
  {
    id: 'yz-13', slug: 'kamia-bloom', name: 'Kamia Bloom',
    tagline: 'Ginger lily, peach blossom and a little peony.',
    family: 'floral', concentration: 'eau-de-toilette', wear: 'for-her', tier: 'signature', volumes: ALL, inStock: true,
    notes: { top: ['Pear', 'Peach blossom'], heart: ['Ginger lily', 'Peony'], base: ['Musk', 'Sandalwood'] },
    story: [
      'Kamia, the ginger lily, smells fresh, a little spicy and entirely unforced.',
      'A light floral for gifting sets and everyday wear.',
    ],
    bottle: { shape: 'sphere', liquid: '#F4CDBF', cap: 'gold' },
  },
  {
    id: 'yz-14', slug: 'mangga-verde', name: 'Mangga Verde',
    tagline: 'Green mango, lime and cucumber over clean vetiver.',
    family: 'green', concentration: 'eau-de-toilette', wear: 'shared', tier: 'signature', volumes: ALL, inStock: true,
    notes: { top: ['Green mango', 'Lime'], heart: ['Mint', 'Cucumber'], base: ['Vetiver', 'White musk'] },
    story: [
      'Unripe mango with a pinch of salt, in a sparkling, summery eau de toilette.',
    ],
    bottle: { shape: 'drop', liquid: '#B7D76A', cap: 'silver' },
  },
  {
    id: 'yz-15', slug: 'tsokolate-tablea', name: 'Tsokolate Tablea',
    tagline: 'Stone-ground cacao, orange peel and cinnamon.',
    family: 'gourmand', concentration: 'eau-de-parfum', wear: 'shared', tier: 'signature', volumes: MID, inStock: false,
    notes: { top: ['Cacao nibs', 'Orange peel'], heart: ['Tablea chocolate', 'Cinnamon'], base: ['Vanilla', 'Benzoin'] },
    story: [
      'Thick, bitter hot chocolate, slightly sweetened. Currently between batches.',
    ],
    bottle: { shape: 'arch', liquid: '#6A3F2C', cap: 'wood' },
  },
];
