import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { CoinMark, InfoPill, RewardCta } from '@/features/rewards/components/rewards-primitives';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardHero } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';
import type { RewardWallet } from '@/types/rewards';

/**
 * The balance hero - the strongest element on the page, and the answer to
 * the first question a user arrives with ("how many coins do I have?").
 *
 * Reads every number off `wallet`: no default, no fallback figure, and no
 * notion of what a coin is worth. Coins only - no rupiah equivalent,
 * because they have no approved cash value and rendering one would be a
 * misleading cash-value visual.
 *
 * THE VALUE HINT IS A STRING THIS CARD DOES NOT COMPOSE. The reference puts
 * "~4 premium episodes" beside the balance; the backend sells VIP by DAYS
 * and publishes no episodes-per-coin rate, so that particular sentence
 * cannot be told truthfully. What arrives in `valueHint` is derived from the
 * server's own offer list by `selectRedeemHint` and localised by the screen
 * - and when there is nothing truthful to say, it arrives as `null` and the
 * pill simply does not render.
 *
 * The preview tag still renders only while `isServerAuthoritative` is false,
 * so a figure that did not come from the server is never shown unqualified.
 */

type PointsBalanceCardProps = {
  readonly wallet: RewardWallet;
  /**
   * Server-derived, already-localised statement of what this balance buys.
   * `null` renders no pill rather than a placeholder.
   */
  readonly valueHint?: string | null;
  /**
   * Jumps to the redemption section further down this same scroll. Omitted
   * when there is no catalog to jump to, in which case no button renders -
   * a CTA that scrolls to an empty section is worse than no CTA.
   */
  readonly onPressRedeem?: () => void;
};

export function PointsBalanceCard({
  wallet,
  valueHint = null,
  onPressRedeem,
}: PointsBalanceCardProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();
  const balanceLabel = formatPoints(wallet.balancePoints);

  return (
    <LinearGradient
      colors={RewardHero.gradient}
      end={{ x: 1, y: 1 }}
      start={{ x: 0.1, y: 0 }}
      style={styles.card}
      testID="rewards-balance">
      {/* One translucent disc, not a blur stack: the warm light at the upper
          right is the whole effect, and it costs a single composited layer
          on the low-end Android this demo targets. */}
      <View pointerEvents="none" style={styles.glow} />

      {/* The announced sentence carries the SAME qualifier the visible tag
          does. A screen-reader user must not be the only one who hears an
          unqualified figure when the balance did not come from the server. */}
      <View
        accessible
        accessibilityLabel={t(
          wallet.isServerAuthoritative ? 'rewards.balanceA11y' : 'rewards.balancePreviewA11y',
          { points: balanceLabel }
        )}>
        <View style={styles.labelRow}>
          <CoinMark size={15} />
          <Text style={styles.label}>{t('rewards.yourPoints')}</Text>
        </View>
        <View style={styles.balanceRow}>
          <Text
            maxFontSizeMultiplier={1.5}
            style={styles.balanceValue}
            testID="rewards-balance-value">
            {balanceLabel}
          </Text>
          <Text style={styles.balanceUnit}>{t('rewards.pointsUnit')}</Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        {onPressRedeem ? (
          <RewardCta
            isSupported
            label={t('rewards.goToRedeem')}
            onPress={onPressRedeem}
            testID="rewards-balance-redeem"
            tone="primary"
          />
        ) : null}

        {valueHint ? (
          <InfoPill testID="rewards-balance-hint">
            <Text style={styles.hintText}>{valueHint}</Text>
          </InfoPill>
        ) : null}
      </View>

      {/* Preview status travels with the number itself, so the figure is
          never seen without its qualifier - even mid-scroll. */}
      {wallet.isServerAuthoritative ? null : (
        <View style={styles.previewTag} testID="rewards-balance-preview-tag">
          <Text style={styles.previewTagText}>{t('rewards.balancePreviewTag')}</Text>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: RewardHero.border,
    borderRadius: Radius.xxl,
  },
  glow: {
    position: 'absolute',
    top: -74,
    right: -46,
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: RewardHero.glow,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  label: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: '#F0D5CC',
  },
  balanceRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 7,
  },
  balanceValue: {
    fontSize: 40,
    // No literal lineHeight: at this size a fixed line box leaves no
    // headroom, and it would not grow with the OS text-size setting.
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  balanceUnit: {
    paddingBottom: 7,
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
    color: '#E4C3B8',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  hintText: {
    fontSize: 12,
    fontFamily: FontFamily.semiBold,
    color: Palette.text,
  },
  previewTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 26, 0.4)',
    backgroundColor: 'rgba(255, 122, 26, 0.14)',
  },
  previewTagText: {
    fontSize: 11.5,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
  },
});
