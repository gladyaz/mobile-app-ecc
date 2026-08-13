import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { RewardNotice } from '@/features/rewards/components/rewards-primitives';
import { formatPoints } from '@/features/rewards/format-points';
import { RewardAccent } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';
import type { RewardWallet } from '@/types/rewards';

/**
 * The balance hero. Reads every number off `wallet` - it has no default,
 * no fallback figure, and no notion of what a point is worth.
 *
 * Deliberately shows points only. No rupiah equivalent, no "senilai Rp X"
 * line: points have no approved cash value, and rendering one would be a
 * misleading cash-value visual.
 */

type PointsBalanceCardProps = {
  readonly wallet: RewardWallet;
};

export function PointsBalanceCard({ wallet }: PointsBalanceCardProps) {
  const { t } = useTranslation();
  const balanceLabel = formatPoints(wallet.balancePoints);

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

      {/* Each pair is one accessible node, so a screen reader announces
          "Total didapat 8.400 poin" rather than two disjoint stops. */}
      <View style={styles.metaRow}>
        <View
          accessible
          accessibilityLabel={t('rewards.totalEarnedA11y', {
            points: formatPoints(wallet.lifetimeEarnedPoints),
          })}
          style={styles.metaItem}>
          <Text style={styles.metaLabel}>{t('rewards.totalEarned')}</Text>
          <Text style={styles.metaValue} testID="rewards-lifetime-value">
            {formatPoints(wallet.lifetimeEarnedPoints)}
          </Text>
        </View>
        {wallet.updatedAtLabel ? (
          <View
            accessible
            accessibilityLabel={t('rewards.updatedA11y', { value: wallet.updatedAtLabel })}
            style={styles.metaItem}>
            <Text style={styles.metaLabel}>{t('rewards.updated')}</Text>
            <Text style={styles.metaValue}>{wallet.updatedAtLabel}</Text>
          </View>
        ) : null}
      </View>

      {wallet.isServerAuthoritative ? null : (
        <RewardNotice
          message={t('rewards.balanceNotAuthoritative')}
          testID="rewards-balance-notice"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    gap: 14,
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
    gap: 8,
  },
  balanceValue: {
    fontSize: 40,
    // No literal lineHeight: at 40px a fixed 46px line box left almost no
    // headroom, and it would not have grown with the OS text-size setting.
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  balanceUnit: {
    paddingBottom: 7,
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 24,
  },
  metaItem: {
    gap: 2,
  },
  metaLabel: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  metaValue: {
    fontSize: 14,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
});
