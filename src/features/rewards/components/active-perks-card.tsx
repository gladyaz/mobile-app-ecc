import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { RewardSurface, scaledLineHeight } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';
import type { ActivePerks } from '@/types/rewards';

/**
 * What the viewer already holds, rendered directly above the offers that
 * sell it.
 *
 * WHY IT SITS IN THE REDEEM SECTION rather than beside the balance: the
 * question it answers is "do I already have this?", and that question is only
 * asked while looking at the thing for sale. A perk strip next to the coin
 * hero would be a second inventory the viewer has to remember on the way
 * down the page.
 *
 * PRESENTATIONAL, AND NOT THE AD GATE'S SOURCE. This component renders
 * `perks[]`, which is the display list. Whether an ad is actually suppressed
 * is decided from `skipNextInterstitial` / `adFreeUntil` in
 * `services/ads/ad-gate.ts` - two SERVER-derived values the gate reads
 * directly. Nothing here participates in that decision, so no amount of
 * editing this file can grant a viewer a free ad skip.
 *
 * A perk type this build has no copy for is already dropped by the mapper,
 * so an empty list here does NOT mean the viewer holds nothing - it means
 * there is nothing this build can name. The benefit still applies, because
 * it travels on the two derived values rather than on this list.
 */

type ActivePerksCardProps = {
  readonly activePerks: ActivePerks;
};

export function ActivePerksCard({ activePerks }: ActivePerksCardProps) {
  const { t } = useTranslation();

  if (activePerks.perks.length === 0) {
    return null;
  }

  return (
    <View style={styles.card} testID="rewards-active-perks">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('rewards.sectionPerks')}
      </Text>

      {activePerks.perks.map((perk) => (
        <View key={perk.id} style={styles.row} testID={`rewards-active-perk-${perk.id}`}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.mark}>
            <Text style={styles.markText}>✓</Text>
          </View>
          <View style={styles.body}>
            <Text style={styles.title}>{perk.title}</Text>
            {/* Two facts, both the server's: what is left of it, and when it
                stops working. The expiry is the one a viewer needs in order
                to decide whether to spend it now - a perk that quietly ran
                out is the failure this line exists to prevent. */}
            <Text style={styles.detail}>{`${perk.detail} · ${perk.expiresAtLabel}`}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: RewardSurface.cardBorder,
    borderRadius: Radius.xl,
    backgroundColor: RewardSurface.card,
  },
  heading: {
    fontSize: 12,
    fontFamily: FontFamily.extraBold,
    color: Palette.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mark: {
    // min-, not fixed: the glyph scales with the OS text-size setting and a
    // fixed box clips it outright at the largest sizes.
    minWidth: 26,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 26, 0.42)',
    backgroundColor: 'rgba(255, 122, 26, 0.16)',
  },
  markText: {
    fontSize: 13,
    fontFamily: FontFamily.extraBold,
    color: Palette.primaryHover,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  detail: {
    fontSize: 11,
    lineHeight: scaledLineHeight(11),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
});
