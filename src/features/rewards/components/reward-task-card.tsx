import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  PointsPill,
  RewardCta,
  RewardProgressBar,
} from '@/features/rewards/components/rewards-primitives';
import { formatPoints } from '@/features/rewards/format-points';
import { RewardAccent, scaledLineHeight } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';
import type { RewardTask, RewardTaskType, SocialPlatform } from '@/types/rewards';

/**
 * One task row: mark, what it is, what it pays, and one control.
 *
 * Every task type renders through this single path - a social follow, a
 * rewarded ad and a future campaign differ only in their data.
 *
 * Reshaped in the UX pass from a stacked information card into a scannable
 * row. Gone: the status chip (the CTA label already carries state - a locked
 * task's CTA reads "Coming Soon"), and the per-card caveat paragraph, which
 * is now one page-level banner. What a user needs in order to compare five
 * tasks is the platform, the task, the reward and the button; everything
 * else was noise between them.
 *
 * Pressing the CTA calls `onPressCta` and does nothing else. There is no
 * award, no claim, no local counter increment, and no navigation to a
 * social app or ad unit.
 */

/**
 * Short text marks instead of brand logos: this feature ships no licensed
 * brand assets, and a hand-drawn approximation of a platform mark would be
 * worse than a plain initial. No icon package is added for this.
 */
const PLATFORM_MARK: Record<SocialPlatform, string> = {
  FACEBOOK: 'FB',
  YOUTUBE: 'YT',
  TIKTOK: 'TT',
  INSTAGRAM: 'IG',
};

const TYPE_MARK: Record<RewardTaskType, string> = {
  // Not "SOS" - a distress signal is a poor mark for a follow task, even
  // though this branch is unreachable while every social fixture supplies a
  // `socialPlatform`.
  SOCIAL_FOLLOW: 'SNS',
  REWARDED_AD: 'AD',
  WATCH_TIME: 'MIN',
  // Not "NEW": a campaign row also renders a locked "Coming Soon" CTA, and
  // a NEW badge beside it read as a contradiction.
  CAMPAIGN: 'MISI',
  DAILY_CHECK_IN: 'DAY',
};

type RewardTaskCardProps = {
  readonly task: RewardTask;
  readonly onPressCta: (task: RewardTask) => void;
};

export function RewardTaskCard({ task, onPressCta }: RewardTaskCardProps) {
  const { t } = useTranslation();
  const mark = task.socialPlatform ? PLATFORM_MARK[task.socialPlatform] : TYPE_MARK[task.type];

  return (
    <View style={styles.row} testID={`reward-task-${task.id}`}>
      {/* Decorative: the title beside it already names the task. Both props
          are needed - `importantForAccessibility` is Android-only and
          `accessibilityElementsHidden` is iOS-only, so setting one alone
          leaves VoiceOver announcing a stray "FB" / "AD". */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.mark}
        testID={`reward-task-mark-${task.id}`}>
        <Text style={styles.markText}>{mark}</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>{task.title}</Text>
        <Text style={styles.description}>{task.description}</Text>

        {task.progress ? (
          <View style={styles.progressBlock}>
            <RewardProgressBar
              current={task.progress.current}
              label={t('rewards.progressA11y', { title: task.title })}
              target={task.progress.target}
              testID={`reward-task-progress-bar-${task.id}`}
            />
            <Text style={styles.progressValue} testID={`reward-task-progress-${task.id}`}>
              {t('rewards.progressShort', {
                current: formatPoints(task.progress.current),
                target: formatPoints(task.progress.target),
              })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.trailing}>
        <PointsPill points={task.rewardPoints} testID={`reward-task-points-${task.id}`} />
        <RewardCta
          // Three of the five rows ship the same CTA word, so the announced
          // name carries the task it belongs to ("Follow: TikTok").
          accessibilityLabel={t('rewards.ctaA11y', { label: task.ctaLabel, title: task.title })}
          compact
          isSupported={task.isClaimSupported}
          label={task.ctaLabel}
          onPress={() => onPressCta(task)}
          testID={`reward-task-cta-${task.id}`}
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
  mark: {
    // min-, not fixed: the glyphs scale with the OS text-size setting and a
    // fixed box clips them outright at the largest sizes.
    minWidth: 38,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  markText: {
    fontSize: 11.5,
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  description: {
    fontSize: 11.5,
    lineHeight: scaledLineHeight(11.5),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  progressBlock: {
    marginTop: 5,
    gap: 4,
  },
  progressValue: {
    fontSize: 11,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: 8,
  },
});
