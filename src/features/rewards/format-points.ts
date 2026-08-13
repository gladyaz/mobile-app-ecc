/**
 * Formats a point value for display with Indonesian thousands separators
 * (1250 -> "1.250").
 *
 * Plain string work only - no `Intl`/`toLocaleString`, matching the existing
 * precedent in `src/app/account-security.tsx`: ICU data is not guaranteed to
 * be complete in every JS engine this app runs under.
 *
 * Defensive on purpose. Once these numbers come from the backend they are
 * untrusted input, and a malformed payload must degrade to a readable "0"
 * rather than rendering "NaN" where a balance should be.
 */
export function formatPoints(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  const whole = Math.trunc(value);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return whole < 0 ? `-${digits}` : digits;
}
