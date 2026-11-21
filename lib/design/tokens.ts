// Design tokens. A perfumer's cabinet: aubergine-black "nuit" for the dark rooms, warm
// "papier" for the paper rooms, a gold "or" that only ever sits on nuit, and a deep
// "bordeaux" that only ever sits on papier. Every text pairing below is checked against
// WCAG AA (4.5:1) by tokens.test.ts.

export const COLOURS = {
  nuit: '#17111B',
  nuitRaised: '#251C2E',
  papier: '#F4EDE1',
  papierDeep: '#E8DEC9',
  ink: '#1B1520',
  inkMuted: '#5B5062',
  bordeaux: '#7C2437',
  bordeauxDark: '#5E1A29',
  or: '#E4AE55',
  orSoft: '#B8AABF',
  line: '#D5C8B0',
  white: '#FFFFFF',
} as const;

export type ColourToken = keyof typeof COLOURS;

export const TEXT_PAIRS: { name: string; fg: ColourToken; bg: ColourToken }[] = [
  { name: 'ink on papier', fg: 'ink', bg: 'papier' },
  { name: 'muted ink on papier', fg: 'inkMuted', bg: 'papier' },
  { name: 'ink on deep papier', fg: 'ink', bg: 'papierDeep' },
  { name: 'muted ink on deep papier', fg: 'inkMuted', bg: 'papierDeep' },
  { name: 'papier on bordeaux (buttons)', fg: 'papier', bg: 'bordeaux' },
  { name: 'papier on dark bordeaux (button hover)', fg: 'papier', bg: 'bordeauxDark' },
  { name: 'bordeaux on papier (links)', fg: 'bordeaux', bg: 'papier' },
  { name: 'bordeaux on deep papier (links)', fg: 'bordeaux', bg: 'papierDeep' },
  { name: 'papier on nuit', fg: 'papier', bg: 'nuit' },
  { name: 'or on nuit (accents)', fg: 'or', bg: 'nuit' },
  { name: 'or on raised nuit', fg: 'or', bg: 'nuitRaised' },
  { name: 'soft lilac on nuit (secondary text)', fg: 'orSoft', bg: 'nuit' },
  { name: 'soft lilac on raised nuit', fg: 'orSoft', bg: 'nuitRaised' },
  { name: 'nuit on or (gold buttons)', fg: 'nuit', bg: 'or' },
  { name: 'muted ink on white (field placeholder)', fg: 'inkMuted', bg: 'white' },
];

// WCAG 1.4.11: the boundary of a form field must reach 3:1 against its surround.
export const NON_TEXT_PAIRS: { name: string; fg: ColourToken; bg: ColourToken }[] = [
  { name: 'field border (muted ink) on white', fg: 'inkMuted', bg: 'white' },
  { name: 'field border (muted ink) on papier', fg: 'inkMuted', bg: 'papier' },
];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
