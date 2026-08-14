import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardAccent } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';
import type { RewardWallet } from '@/types/rewards';

/**
 * The balance hero - the strongest element on the page, and the answer to
 * the first question a user arrives with ("how many points do I have?").
 *
 * Reads every number off `wallet`: no default, no fallback figure, and no
 * notion of what a point is worth. Points only - no rupiah equivalent,
 * because points have no approved cash value and rendering one would be a
 * misleading cash-value visual.
 *
 * Two things were deliberately REMOVED from this card in the UX pass:
 *   - the "total earned" / "last updated" metadata row, which competed with
 *     the number that actually matters;
 *   - the paragraph-length "this balance is not authoritative" notice. The
 *     preview status is now a compact tag here plus the page-level banner
 *     above, so it is stated without shouting.
 * The honesty itself is unchanged: `isServerAuthoritative` is still what
 * decides whether the preview tag shows, and the fixture ships it `false`.
 */

type PointsBalanceCardProps = {
  readonly wallet: RewardWallet;
  /**
   * Current check-in streak, surfaced here rather than inside the check-in
   * card so the hero answers "how am I doing?" in one glance. `null` when
   * there is no streak data to show.
   */
  readonly streakDays?: number | null;
};

export function PointsBalanceCard({ wallet, streakDays = null }: PointsBalanceCardProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();
  const balanceLabel = formatPoints(wallet.balancePoints);
  const hasStreak = typeof streakDays === 'number' && streakDays > 0;

  return (
    <View style={styles.card} testID="rewards-balance-card">
      <View accessible accessibilityLabel={t('rewards.balanceA11y', { points: balanceLabel })}>
        <Text style={styles.label}>{t('rewards.yourPoints')}</Text>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceValue} testID="rewards-balance-value">
            {balanceLabel}
          </Text>
          <Text style={styles.balanceUnit}>{t('rewards.pointsUnit')}</Text>
        </View>
      </View>

      <View style={styles.chipRow}>
        {/* Preview status travels with the number itself, so the figure is
            never seen without its qualifier - even mid-scroll. */}
        {wallet.isServerAuthoritative ? null : (
          <View style={styles.previewTag} testID="rewards-balance-preview-tag">
            <Text style={styles.previewTagText}>{t('rewards.balancePreviewTag')}</Text>
          </View>
        )}

        {hasStreak ? (
          <View
            accessible
            accessibilityLabel={t('rewards.streakChipA11y', { days: streakDays })}
            style={styles.streakChip}
            testID="rewards-streak-chip">
            <Text style={styles.streakChipText}>
              {t('rewards.streakChip', { days: streakDays })}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: RewardAccent.goldBorder,
    borderRadius: Radius.xxl,
    backgroundColor: Palette.surface,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0.4,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  balanceRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  balanceValue: {
    fontSize: 44,
    // No literal lineHeight: at this size a fixed line box leaves no
    // headroom, and it would not grow with the OS text-size setting.
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  balanceUnit: {
    paddingBottom: 8,
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  previewTag: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 26, 0.4)',
    backgroundColor: 'rgba(255, 122, 26, 0.09)',
  },
  previewTagText: {
    fontSize: 11.5,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
  },
  streakChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  streakChipText: {
    fontSize: 11.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
});
