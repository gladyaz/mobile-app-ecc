import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { RewardCta, RewardNotice } from '@/features/rewards/components/rewards-primitives';
import { formatPoints } from '@/features/rewards/format-points';
import { RewardAccent, scaledLineHeight } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';
import type { TranslationKey } from '@/services/i18n/translations';
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

const AVAILABILITY_LABEL_KEY: Record<RewardRedemptionAvailability, TranslationKey> = {
  AVAILABLE: 'rewards.availAvailable',
  INSUFFICIENT_POINTS: 'rewards.availInsufficient',
  COMING_SOON: 'rewards.availComingSoon',
};

type RedeemCardProps = {
  readonly redemption: RewardRedemption;
  readonly onPressCta: (redemption: RewardRedemption) => void;
};

export function RedeemCard({ redemption, onPressCta }: RedeemCardProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.card} testID={`redeem-card-${redemption.id}`}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{redemption.title}</Text>
          <Text style={styles.description}>{redemption.description}</Text>
        </View>
        <View style={styles.durationChip}>
          <Text style={styles.durationValue}>{redemption.grantsDays}</Text>
          <Text style={styles.durationUnit}>{t('rewards.daysUnit')}</Text>
        </View>
      </View>

      <View style={styles.footerRow}>
        <View style={styles.costBlock}>
          <Text style={styles.costValue} testID={`redeem-cost-${redemption.id}`}>
            {t('rewards.pointsValue', { points: formatPoints(redemption.costPoints) })}
          </Text>
          <Text style={styles.availability} testID={`redeem-availability-${redemption.id}`}>
            {/* Only AVAILABLE is downgraded. "Bisa ditukar" is a promise
                this slice cannot keep - with a 1250-point preview balance
                sitting above a 1000-point cost it reads as a real, affordable
                redemption, and the retraction is only in the smaller notice
                below. The other two states are already truthful ("not enough
                points", "coming soon") and stay as they are, so downgrading
                them would throw away real information. Once a backend can
                actually redeem, `isRedeemSupported` flips and AVAILABLE
                speaks for itself. */}
            {t(
              redemption.availability === 'AVAILABLE' && !redemption.isRedeemSupported
                ? 'rewards.availComingSoon'
                : AVAILABILITY_LABEL_KEY[redemption.availability]
            )}
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
        <RewardNotice
          message={t('rewards.redeemNotSupported')}
          testID={`redeem-notice-${redemption.id}`}
        />
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
