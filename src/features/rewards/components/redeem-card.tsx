import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { RewardCta } from '@/features/rewards/components/rewards-primitives';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardAccent, scaledLineHeight } from '@/features/rewards/rewards-theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type { RewardRedemption, RewardRedemptionAvailability } from '@/types/rewards';

/**
 * A VIP redemption offer, as a comparable row.
 *
 * This file deliberately imports nothing from `@/stores/entitlement` or
 * `@/services/entitlement`. Redemption is a server-side transaction - the
 * backend debits the ledger and issues the entitlement change atomically,
 * or neither happens. A client that flips a premium flag locally would be
 * both wrong and trivially abusable, so the wiring does not exist here even
 * as a placeholder, and a boundary test fails if it ever appears.
 *
 * The UX pass made the three offers comparable at a glance: cost is the
 * prominent figure on a consistent right edge, so 1.000 / 2.500 / 5.000 line
 * up down the column. The per-card "redemption is not active" paragraph is
 * gone; availability is one short phrase and the page-level banner carries
 * the preview status.
 *
 * INTEGRATION NOTE: `redemption.grantsDays` is intentionally not rendered.
 * Today every fixture title already spells the duration out ("VIP 1 Hari"),
 * so showing both would just repeat it. If a real backend ever sends a
 * generic title ("VIP Access") with `grantsDays` as the only source of
 * truth, the tiers would become indistinguishable except by cost - render
 * the field then.
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
  const formatPoints = useFormatPoints();

  return (
    <View style={styles.row} testID={`redeem-card-${redemption.id}`}>
      <View style={styles.body}>
        <Text style={styles.title}>{redemption.title}</Text>
        <Text style={styles.description}>{redemption.description}</Text>
        {/* Availability is a word, never a colour cue on its own.
            Only AVAILABLE is downgraded, and only while redemption is
            unsupported: "Bisa ditukar"/"Redeemable" is a promise this
            preview cannot keep. With a 1.250-point preview balance sitting
            above a 1.000-point cost, that word makes the offer read as real
            AND affordable, and the grey button alone is too quiet to correct
            it. When redemption goes live, `isRedeemSupported` flips and the
            true label appears with no copy change here. */}
        <Text style={styles.availability} testID={`redeem-availability-${redemption.id}`}>
          {t(
            redemption.availability === 'AVAILABLE' && !redemption.isRedeemSupported
              ? 'rewards.availComingSoon'
              : AVAILABILITY_LABEL_KEY[redemption.availability]
          )}
        </Text>
      </View>

      <View style={styles.trailing}>
        <Text style={styles.costValue} testID={`redeem-cost-${redemption.id}`}>
          {t('rewards.costPoints', { points: formatPoints(redemption.costPoints) })}
        </Text>
        <RewardCta
          // Two of the three offers ship the same CTA word, so the announced
          // name carries the tier ("Tukar: VIP 3 Hari").
          accessibilityLabel={t('rewards.ctaA11y', {
            label: redemption.ctaLabel,
            title: redemption.title,
          })}
          compact
          isSupported={redemption.isRedeemSupported}
          label={redemption.ctaLabel}
          onPress={() => onPressCta(redemption)}
          testID={`redeem-cta-${redemption.id}`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 14.5,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  description: {
    fontSize: 11.5,
    lineHeight: scaledLineHeight(11.5),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  availability: {
    marginTop: 1,
    fontSize: 11,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: 8,
  },
  costValue: {
    fontSize: 14,
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
});
