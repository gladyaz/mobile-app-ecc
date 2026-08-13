import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette } from '@/constants/theme';
import { DailyCheckInCard } from '@/features/rewards/components/daily-check-in-card';
import { RewardTaskCard } from '@/features/rewards/components/reward-task-card';
import { RewardEmptyState } from '@/features/rewards/components/rewards-primitives';
import { WatchTimeCard } from '@/features/rewards/components/watch-time-card';
import type {
  DailyCheckIn,
  RewardTask,
  RewardTaskType,
  RewardsPrototypeAction,
  WatchTimeProgress,
} from '@/types/rewards';

/**
 * The "Kumpulkan" (earn) tab: check-in, watch-time, and the task list.
 *
 * Every section renders an empty state rather than disappearing when its
 * data is absent, so a missing section is never mistaken for a bug.
 */

type EarnPanelProps = {
  readonly dailyCheckIn: DailyCheckIn | null;
  readonly watchTime: WatchTimeProgress | null;
  readonly tasks: readonly RewardTask[];
  readonly onAction: (action: RewardsPrototypeAction) => void;
};

/**
 * Ids of the tasks that should carry their type's caveat block.
 *
 * The caveat ("follow can't be verified", "no ad SDK yet") is a property of
 * the task TYPE, not of the individual task. Repeating one identical block
 * under each of three adjacent social cards trained users to skip all of
 * them, so the message is shown once, on the first unsupported task of each
 * type, and the rest of the group stays clean.
 */
function selectNoticeTaskIds(tasks: readonly RewardTask[]): ReadonlySet<string> {
  const seenTypes = new Set<RewardTaskType>();
  const noticeIds = new Set<string>();

  for (const task of tasks) {
    if (!task.isClaimSupported && !seenTypes.has(task.type)) {
      seenTypes.add(task.type);
      noticeIds.add(task.id);
    }
  }

  return noticeIds;
}

export function EarnPanel({ dailyCheckIn, watchTime, tasks, onAction }: EarnPanelProps) {
  const noticeTaskIds = useMemo(() => selectNoticeTaskIds(tasks), [tasks]);

  return (
    // React Native's `AccessibilityRole` union has no `tabpanel` member (it
    // is a web ARIA role), so panel membership is conveyed the RN way: each
    // section is introduced by a `header`-role heading that screen readers
    // can jump between.
    <View style={styles.section} testID="rewards-earn-panel">
      {dailyCheckIn ? (
        <DailyCheckInCard
          checkIn={dailyCheckIn}
          onPressCta={() =>
            onAction({
              kind: 'DAILY_CHECK_IN',
              id: 'daily_check_in',
              label: dailyCheckIn.ctaLabel,
            })
          }
        />
      ) : (
        <RewardEmptyState
          message="Check-in harian belum tersedia."
          testID="rewards-check-in-empty"
        />
      )}

      {watchTime ? (
        <WatchTimeCard
          onPressCta={() =>
            onAction({ kind: 'WATCH_TIME', id: 'watch_time', label: 'Klaim Hadiah Durasi' })
          }
          watchTime={watchTime}
        />
      ) : (
        <RewardEmptyState
          message="Progres durasi tonton belum tersedia."
          testID="rewards-watch-time-empty"
        />
      )}

      <Text accessibilityRole="header" style={styles.sectionHeading}>
        Misi Poin
      </Text>
      {tasks.length > 0 ? (
        tasks.map((task) => (
          <RewardTaskCard
            key={task.id}
            onPressCta={(pressed) => onAction({ kind: 'TASK', id: pressed.id, label: pressed.title })}
            showUnsupportedNotice={noticeTaskIds.has(task.id)}
            task={task}
          />
        ))
      ) : (
        <RewardEmptyState message="Belum ada misi tersedia." testID="rewards-tasks-empty" />
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
