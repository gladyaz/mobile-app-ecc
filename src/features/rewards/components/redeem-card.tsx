import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { CoinMark, RewardCta } from '@/features/rewards/components/rewards-primitives';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardAccent, RewardSurface, scaledLineHeight } from '@/features/rewards/rewards-theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type { RewardRedemption, RewardRedemptionAvailability } from '@/types/rewards';

/**
 * A VIP redemption offer, as a comparable card.
 *
 * This file deliberately imports nothing from `@/stores/entitlement` or
 * `@/services/entitlement`. Redemption is a server-side transaction - the
 * backend debits the ledger and issues the entitlement change atomically,
 * or neither happens. A client that flips a premium flag locally would be
 * both wrong and trivially abusable, so the wiring does not exist here even
 * as a placeholder, and a boundary test fails if it ever appears.
 *
 * The three offers stay comparable at a glance: title, what it grants, then
 * the cost on its own line behind a coin mark, so 1.000 / 2.500 / 5.000 line
 * up down the column with the CTA on a clean right edge.
 *
 * NO "BEST VALUE" RIBBON. The reference design badges its middle tier
 * `TERBAIK`. Nothing in the redemption contract marks a recommended offer -
 * there is no `isRecommended`, no rank, no tag - so the badge would be this
 * screen picking a product winner on the backend's behalf. When the contract
 * gains a marker, render it from that field; do not restore it from a
 * position in the list.
 *
 * INTEGRATION NOTE: `redemption.grantsDays` is intentionally not rendered.
 * Today every offer title already spells the duration out ("VIP 1 Hari"),
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
  /** This offer's redemption request is in flight. Blocks a second press. */
  readonly isPending?: boolean;
};

export function RedeemCard({ redemption, onPressCta, isPending = false }: RedeemCardProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();
  /**
   * Both halves come from the server and neither is recomputed here.
   * `isRedeemSupported` says the offer is purchasable in principle;
   * `availability` says whether THIS account can afford it right now, decided
   * against the server's own balance. Re-deriving affordability from the
   * number in the hero would let a stale balance light up a button the
   * backend is about to refuse.
   */
  const isActionable = redemption.isRedeemSupported && redemption.availability === 'AVAILABLE';

  return (
    <View
      style={[styles.card, isActionable && styles.cardActionable]}
      testID={`rewards-redemption-${redemption.id}`}>
      <View style={styles.body}>
        <Text style={styles.title}>{redemption.title}</Text>
        <Text style={styles.description}>{redemption.description}</Text>

        <View style={styles.costRow}>
          <CoinMark isMuted={!isActionable} size={13} />
          <Text style={styles.costValue} testID={`rewards-redemption-cost-${redemption.id}`}>
            {t('rewards.costPoints', { points: formatPoints(redemption.costPoints) })}
          </Text>
          {/* Availability is a word, never a colour cue on its own.
              Only AVAILABLE is downgraded, and only while redemption is
              unsupported: "Bisa ditukar"/"Redeemable" is a promise an
              unsupported offer cannot keep, and with a balance sitting above
              the cost that word makes the offer read as real AND affordable,
              which the grey button alone is too quiet to correct. When
              redemption goes live, `isRedeemSupported` flips and the true
              label appears with no copy change here. */}
          <Text
            style={styles.availability}
            testID={`rewards-redemption-availability-${redemption.id}`}>
            {t(
              redemption.availability === 'AVAILABLE' && !redemption.isRedeemSupported
                ? 'rewards.availComingSoon'
                : AVAILABILITY_LABEL_KEY[redemption.availability]
            )}
          </Text>
        </View>
      </View>

      <RewardCta
        // Two of the three offers ship the same CTA word, so the announced
        // name carries the tier ("Tukar: VIP 3 Hari").
        accessibilityLabel={t('rewards.ctaA11y', {
          label: redemption.ctaLabel,
          title: redemption.title,
        })}
        compact
        isPending={isPending}
        isSupported={isActionable}
        label={redemption.ctaLabel}
        onPress={() => onPressCta(redemption)}
        testID={`rewards-redeem-button-${redemption.id}`}
        tone="primary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: RewardSurface.cardBorder,
    borderRadius: Radius.xl,
    backgroundColor: RewardSurface.card,
  },
  cardActionable: {
    // A warm rim on the offers that can actually be bought right now. It is
    // a SECOND cue only: the CTA word and the availability word already say
    // so, so nothing here depends on seeing the border.
    borderColor: 'rgba(255, 122, 26, 0.30)',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 3,
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
  costRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  costValue: {
    fontSize: 13,
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  availability: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
});
