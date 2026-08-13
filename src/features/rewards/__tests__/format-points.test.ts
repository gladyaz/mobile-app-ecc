import { formatPoints } from '@/features/rewards/format-points';

describe('formatPoints', () => {
  it('groups thousands with a dot, matching the app language', () => {
    expect(formatPoints(1250)).toBe('1.250');
    expect(formatPoints(90210)).toBe('90.210');
    expect(formatPoints(1234567)).toBe('1.234.567');
  });

  it('leaves values below a thousand untouched', () => {
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(7)).toBe('7');
    expect(formatPoints(999)).toBe('999');
  });

  it('groups a negative balance without losing its sign', () => {
    // Not expected in the UI, but a ledger correction could produce one and
    // it must not render as garbage.
    expect(formatPoints(-1250)).toBe('-1.250');
  });

  it('truncates fractional points rather than rendering a decimal balance', () => {
    expect(formatPoints(1250.9)).toBe('1.250');
  });

  it('degrades a malformed value to "0" instead of rendering NaN', () => {
    expect(formatPoints(Number.NaN)).toBe('0');
    expect(formatPoints(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
