import { useCallback } from 'react';

import { useTranslation } from '@/stores/language';

/**
 * Formats a point value for display with grouped thousands (1250 -> "1.250"
 * in Indonesian, "1,250" in English and Chinese).
 *
 * The separator is LANGUAGE-DEPENDENT and must not be hardcoded. Indonesian
 * groups with "." and English with ","; rendering "1.250 points" to an
 * English reader says "one point two five", which misstates the balance by
 * three orders of magnitude. This was invisible while the app was
 * Indonesian-only and surfaced the first time the screen was read in English
 * on a device.
 *
 * Plain string work only - no `Intl`/`toLocaleString`, matching the existing
 * precedent in `src/app/account-security.tsx`: ICU data is not guaranteed to
 * be complete in every JS engine this app runs under.
 *
 * Defensive on purpose. Once these numbers come from the backend they are
 * untrusted input, and a malformed payload must degrade to a readable "0"
 * rather than rendering "NaN" where a balance should be.
 */
export function formatPoints(value: number, groupSeparator = '.'): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  const whole = Math.trunc(value);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);

  return whole < 0 ? `-${digits}` : digits;
}

/**
 * `formatPoints` bound to the caller's current language.
 *
 * Components use this rather than the bare function so the separator can
 * never drift from the language the rest of the screen is rendering in.
 */
export function useFormatPoints(): (value: number) => string {
  const { t } = useTranslation();
  const groupSeparator = t('rewards.groupSeparator');

  return useCallback((value: number) => formatPoints(value, groupSeparator), [groupSeparator]);
}
