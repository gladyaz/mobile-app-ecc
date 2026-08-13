import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette } from '@/constants/theme';
import { RedeemCard } from '@/features/rewards/components/redeem-card';
import { RewardEmptyState } from '@/features/rewards/components/rewards-primitives';
import { useTranslation } from '@/stores/language';
import type { RewardRedemption, RewardsPrototypeAction } from '@/types/rewards';

/**
 * The "Tukar Poin" (redeem) tab.
 *
 * Like every other surface in this slice, pressing a CTA only reports the
 * press. No points are debited and no entitlement is granted - that pair is
 * a single server-side transaction, described in
 * `docs/rewards-domain-contract.md`.
 */

type RedeemPanelProps = {
  readonly redemptions: readonly RewardRedemption[];
  readonly onAction: (action: RewardsPrototypeAction) => void;
};

export function RedeemPanel({ redemptions, onAction }: RedeemPanelProps) {
  const { t } = useTranslation();

  return (
    // No `tabpanel` role: that is a web ARIA role with no React Native
    // equivalent. The `header`-role heading below is how a screen reader
    // user recognises they have landed in this panel.
    <View style={styles.section} testID="rewards-redeem-panel">
      <Text accessibilityRole="header" style={styles.sectionHeading}>
        {t('rewards.redeemHeading')}
      </Text>
      {redemptions.length > 0 ? (
        redemptions.map((redemption) => (
          <RedeemCard
            key={redemption.id}
            onPressCta={(pressed) =>
              onAction({ kind: 'REDEMPTION', id: pressed.id, label: pressed.title })
            }
            redemption={redemption}
          />
        ))
      ) : (
        <RewardEmptyState
          message={t('rewards.redemptionsEmpty')}
          testID="rewards-redemptions-empty"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionHeading: {
    marginTop: 4,
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
});
