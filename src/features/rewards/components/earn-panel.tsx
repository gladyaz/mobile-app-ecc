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
 * TWO PRESS OUTCOMES, AND THE SERVER PICKS WHICH. A task the backend marked
 * `isClaimSupported: false` - or one it reports already claimed - reaches
 * `onAction`, which acknowledges the tap and does nothing else. Everything
 * else reaches `onTaskAction`, which the container turns into a real request.
 * This component decides neither: it reads two server-owned flags and routes.
 *
 * The rows that are still unclaimable are unclaimable because the backend has
 * no way to verify them (a finished rewarded ad needs an ad-network server
 * callback that does not exist; a campaign has no completion signal at all).
 * Those flags are server-owned, so the day a signal exists these rows become
 * claimable with no change here and no mobile release.
 */

type EarnPanelProps = {
  readonly tasks: readonly RewardTask[];
  readonly onAction: (action: RewardsUnavailableAction) => void;
  /** A press on a task the SERVER says it can pay. Omitted in preview renders. */
  readonly onTaskAction?: (task: RewardTask) => void;
};

export function EarnPanel({ tasks, onAction, onTaskAction }: EarnPanelProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.list} testID="rewards-earn-panel">
      {tasks.length > 0 ? (
        tasks.map((task) => (
          <RewardTaskCard
            key={task.id}
            onPressCta={(pressed) => {
              // A claimed mission is routed to the acknowledgement branch as
              // well as an unsupported one: there is genuinely nothing left to
              // request, and sending it on would ask the server to re-pay
              // something it has already paid.
              if (!pressed.isClaimSupported || pressed.isClaimed || !onTaskAction) {
                onAction({ kind: 'TASK', id: pressed.id, label: pressed.title });

                return;
              }

              onTaskAction(pressed);
            }}
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
