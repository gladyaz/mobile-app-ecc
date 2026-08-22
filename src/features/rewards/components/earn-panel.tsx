import { StyleSheet, View } from 'react-native';

import { RewardTaskCard } from '@/features/rewards/components/reward-task-card';
import { RewardEmptyState } from '@/features/rewards/components/rewards-primitives';
import { useTranslation } from '@/stores/language';
import type { RewardTask, RewardsUnavailableAction } from '@/types/rewards';

/**
 * The Earn Points list.
 *
 * Narrowed in the UX pass to exactly one job. It previously carried the
 * check-in card, the watch-time card AND the task list behind a tab, which
 * is why those three unrelated things had to compete for one heading. Each
 * now sits under its own section in `RewardsCenterScreen`, and this file
 * renders the scannable task rows and nothing else.
 *
 * The per-type caveat dedup that used to live here is gone with the notices
 * themselves - see `rewards-primitives.tsx` for why.
 *
 * EVERY TASK THE BACKEND SERVES IS CURRENTLY UNCLAIMABLE, and pressing one
 * reports the tap and nothing else. That is not this component's decision:
 * `isClaimSupported` arrives false on each task because the server has no
 * way to verify a social follow, a finished ad or a campaign, and a reward
 * it cannot verify is one it will not pay. The flag is server-owned, so the
 * day a verifiable signal exists these rows become claimable with no change
 * here and no mobile release.
 */

type EarnPanelProps = {
  readonly tasks: readonly RewardTask[];
  readonly onAction: (action: RewardsUnavailableAction) => void;
};

export function EarnPanel({ tasks, onAction }: EarnPanelProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.list} testID="rewards-earn-panel">
      {tasks.length > 0 ? (
        tasks.map((task) => (
          <RewardTaskCard
            key={task.id}
            onPressCta={(pressed) => onAction({ kind: 'TASK', id: pressed.id, label: pressed.title })}
            task={task}
          />
        ))
      ) : (
        <RewardEmptyState message={t('rewards.tasksEmpty')} testID="rewards-tasks-empty" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
});
