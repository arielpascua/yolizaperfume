import { describe, expect, it } from 'vitest';
import { COLOURS, NON_TEXT_PAIRS, TEXT_PAIRS, contrastRatio } from './tokens';

describe('design tokens', () => {
  it.each(TEXT_PAIRS)('$name reaches WCAG AA text contrast (4.5:1)', ({ fg, bg }) => {
    expect(contrastRatio(COLOURS[fg], COLOURS[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('$name reaches 3:1 for a field boundary', ({ fg, bg }) => {
    expect(contrastRatio(COLOURS[fg], COLOURS[bg])).toBeGreaterThanOrEqual(3);
  });

  it('contrast of black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });
});
