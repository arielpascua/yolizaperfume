import { describe, expect, it } from 'vitest';
import { normalizePhMobileNumber } from './phone';

describe('normalizePhMobileNumber', () => {
  it.each([
    ['09170000000', '09170000000'],
    ['639170000000', '639170000000'],
    ['+639170000000', '639170000000'],
    ['0917-000-0000', '09170000000'],
    ['0917 000 0000', '09170000000'],
    ['+63 917 000 0000', '639170000000'],
    ['(0917) 000-0000', '09170000000'],
    ['9170000000', '09170000000'],
  ])('normalises %s', (raw, expected) => {
    expect(normalizePhMobileNumber(raw)).toBe(expected);
  });

  it.each(['', 'abc', '12345', '0917000000', '091700000000', '0217000000', '+1 415 555 0100', '63917000000'])(
    'refuses %s rather than guessing',
    (raw) => {
      expect(normalizePhMobileNumber(raw)).toBeNull();
    },
  );
});
