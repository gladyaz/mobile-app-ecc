import { StyleSheet, View } from 'react-native';

import { RedeemCard } from '@/features/rewards/components/redeem-card';
import { RewardEmptyState } from '@/features/rewards/components/rewards-primitives';
import { useTranslation } from '@/stores/language';
import type { RewardRedemption } from '@/types/rewards';

/**
 * The Redeem list.
 *
 * Pressing an offer calls back up to the screen, which calls back up to the
 * container, which asks the BACKEND. Nothing in this file debits a balance
 * or grants an entitlement: the backend does both in one transaction, or
 * neither happens, and this app re-reads the result. A client that flipped a
 * premium flag locally would be both wrong and trivially abusable, so the
 * wiring does not exist here even as a placeholder - and
 * `__tests__/rewards-economics-boundary.test.ts` fails if it appears.
 */

type RedeemPanelProps = {
  readonly redemptions: readonly RewardRedemption[];
  readonly onRedeem: (redemption: RewardRedemption) => void;
  /**
   * The offer whose request is in flight, or `null`. Compared by id so only
   * the pressed row shows a spinner - not the whole list.
   */
  readonly pendingRedemptionId?: string | null;
};

export function RedeemPanel({
  redemptions,
  onRedeem,
  pendingRedemptionId = null,
}: RedeemPanelProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.list} testID="rewards-redeem">
      {redemptions.length > 0 ? (
        redemptions.map((redemption) => (
          <RedeemCard
            isPending={pendingRedemptionId === redemption.id}
            key={redemption.id}
            onPressCta={onRedeem}
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
