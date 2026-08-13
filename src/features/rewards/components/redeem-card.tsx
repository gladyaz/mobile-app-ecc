import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { RewardCta, RewardNotice } from '@/features/rewards/components/rewards-primitives';
import { formatPoints } from '@/features/rewards/format-points';
import { RewardAccent, scaledLineHeight } from '@/features/rewards/rewards-theme';
import type { RewardRedemption, RewardRedemptionAvailability } from '@/types/rewards';

/**
 * A VIP redemption offer.
 *
 * This file deliberately imports nothing from `@/stores/entitlement` or
 * `@/services/entitlement`. Redemption is a server-side transaction - the
 * backend debits the ledger and issues the entitlement change atomically,
 * or neither happens. A client that flips a premium flag locally would be
 * both wrong and trivially abusable, so the wiring does not exist here even
 * as a placeholder.
 */

const NOT_SUPPORTED_MESSAGE =
  'Penukaran belum aktif. Tombol ini tidak memotong poin dan tidak mengaktifkan VIP.';

const AVAILABILITY_LABEL: Record<RewardRedemptionAvailability, string> = {
  AVAILABLE: 'Bisa ditukar',
  INSUFFICIENT_POINTS: 'Poin belum cukup',
  COMING_SOON: 'Segera hadir',
};

type RedeemCardProps = {
  readonly redemption: RewardRedemption;
  readonly onPressCta: (redemption: RewardRedemption) => void;
};

export function RedeemCard({ redemption, onPressCta }: RedeemCardProps) {
  return (
    <View style={styles.card} testID={`redeem-card-${redemption.id}`}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{redemption.title}</Text>
          <Text style={styles.description}>{redemption.description}</Text>
        </View>
        <View style={styles.durationChip}>
          <Text style={styles.durationValue}>{redemption.grantsDays}</Text>
          <Text style={styles.durationUnit}>hari</Text>
        </View>
      </View>

      <View style={styles.footerRow}>
        <View style={styles.costBlock}>
          <Text style={styles.costValue} testID={`redeem-cost-${redemption.id}`}>
            {formatPoints(redemption.costPoints)} poin
          </Text>
          <Text style={styles.availability} testID={`redeem-availability-${redemption.id}`}>
            {AVAILABILITY_LABEL[redemption.availability]}
          </Text>
        </View>
        <RewardCta
          isSupported={redemption.isRedeemSupported}
          label={redemption.ctaLabel}
          onPress={() => onPressCta(redemption)}
          testID={`redeem-cta-${redemption.id}`}
        />
      </View>

      {redemption.isRedeemSupported ? null : (
        <RewardNotice message={NOT_SUPPORTED_MESSAGE} testID={`redeem-notice-${redemption.id}`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  title: {
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  description: {
    fontSize: 11.5,
    lineHeight: scaledLineHeight(11.5),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  durationChip: {
    minWidth: 56,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  durationValue: {
    fontSize: 20,
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  durationUnit: {
    fontSize: 10,
    fontFamily: FontFamily.bold,
    color: RewardAccent.gold,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  costBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  costValue: {
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  availability: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
});
