import { StyleSheet, View } from 'react-native';

import { RedeemCard } from '@/features/rewards/components/redeem-card';
import { RewardEmptyState } from '@/features/rewards/components/rewards-primitives';
import { useTranslation } from '@/stores/language';
import type { RewardRedemption, RewardsPrototypeAction } from '@/types/rewards';

/**
 * The Redeem list.
 *
 * Previously the far side of a tab, which hid the answer to "what can I
 * eventually get for these points?" behind an extra tap. It is now a plain
 * section on the same scroll, so the reward loop reads top to bottom:
 * balance -> daily -> earn -> watch -> redeem.
 *
 * Like every other surface here, pressing a CTA only reports the press. No
 * points are debited and no entitlement is granted - that pair is a single
 * server-side transaction, described in `docs/rewards-domain-contract.md`.
 */

type RedeemPanelProps = {
  readonly redemptions: readonly RewardRedemption[];
  readonly onAction: (action: RewardsPrototypeAction) => void;
};

export function RedeemPanel({ redemptions, onAction }: RedeemPanelProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.list} testID="rewards-redeem-panel">
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
  list: {
    gap: 10,
  },
});
