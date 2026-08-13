import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  PointsPill,
  RewardCta,
  RewardNotice,
  RewardProgressBar,
} from '@/features/rewards/components/rewards-primitives';
import { formatPoints } from '@/features/rewards/format-points';
import { RewardAccent, scaledLineHeight } from '@/features/rewards/rewards-theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type { RewardTask, RewardTaskStatus, RewardTaskType, SocialPlatform } from '@/types/rewards';

/**
 * One task row. Renders every task type from the same contract - a social
 * follow, a rewarded ad, a watch-time task and a future campaign differ
 * only in their data, not in their code path.
 *
 * Pressing the CTA calls `onPressCta` and does nothing else. There is no
 * award, no claim, no local counter increment, and no navigation to a
 * social app or ad unit in this slice.
 */

const STATUS_LABEL_KEY: Record<RewardTaskStatus, TranslationKey> = {
  LOCKED: 'rewards.taskStatusLocked',
  AVAILABLE: 'rewards.taskStatusAvailable',
  IN_PROGRESS: 'rewards.taskStatusInProgress',
  CLAIMABLE: 'rewards.taskStatusClaimable',
  COMPLETED: 'rewards.taskStatusCompleted',
};

/**
 * Why each type cannot pay out yet.
 *
 * The caveat is a property of the task TYPE, not of the individual task, so
 * `EarnPanel` decides which card displays it (see `showUnsupportedNotice`)
 * rather than every card repeating an identical block.
 */
const UNSUPPORTED_TASK_MESSAGE_KEY: Record<RewardTaskType, TranslationKey> = {
  SOCIAL_FOLLOW: 'rewards.unsupportedSocialFollow',
  REWARDED_AD: 'rewards.unsupportedRewardedAd',
  WATCH_TIME: 'rewards.unsupportedWatchTime',
  CAMPAIGN: 'rewards.unsupportedCampaign',
  DAILY_CHECK_IN: 'rewards.unsupportedDailyCheckIn',
};

/**
 * Short text marks instead of brand logos: this slice ships no licensed
 * brand assets, and a hand-drawn approximation of a platform mark would be
 * worse than a plain initial.
 */
const PLATFORM_MARK: Record<SocialPlatform, string> = {
  FACEBOOK: 'FB',
  YOUTUBE: 'YT',
  TIKTOK: 'TT',
  INSTAGRAM: 'IG',
};

const TYPE_MARK: Record<RewardTaskType, string> = {
  SOCIAL_FOLLOW: 'SOS',
  REWARDED_AD: 'AD',
  WATCH_TIME: 'MIN',
  CAMPAIGN: 'NEW',
  DAILY_CHECK_IN: 'DAY',
};

type RewardTaskCardProps = {
  readonly task: RewardTask;
  readonly onPressCta: (task: RewardTask) => void;
  /**
   * Whether this card carries the caveat block for its type. The screen
   * sets it on the first unsupported task of each type so the message is
   * stated once per group rather than once per card.
   */
  readonly showUnsupportedNotice?: boolean;
};

export function RewardTaskCard({
  task,
  onPressCta,
  showUnsupportedNotice = false,
}: RewardTaskCardProps) {
  const { t } = useTranslation();
  const mark = task.socialPlatform ? PLATFORM_MARK[task.socialPlatform] : TYPE_MARK[task.type];

  return (
    <View style={styles.card} testID={`reward-task-${task.id}`}>
      <View style={styles.topRow}>
        {/* Decorative: the title beside it already names the task. Both
            props are needed - `importantForAccessibility` is Android-only
            and `accessibilityElementsHidden` is iOS-only, so setting one
            alone leaves VoiceOver announcing a stray "FB" / "AD". */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.mark}>
          <Text style={styles.markText}>{mark}</Text>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>{task.title}</Text>
          <Text style={styles.description}>{task.description}</Text>
        </View>

        <PointsPill points={task.rewardPoints} testID={`reward-task-points-${task.id}`} />
      </View>

      {task.progress ? (
        <View style={styles.progressBlock}>
          <View style={styles.progressLabelRow}>
            <Text style={styles.progressLabel}>{t('rewards.progress')}</Text>
            <Text style={styles.progressValue} testID={`reward-task-progress-${task.id}`}>
              {formatPoints(task.progress.current)} / {formatPoints(task.progress.target)}
            </Text>
          </View>
          <RewardProgressBar
            current={task.progress.current}
            label={t('rewards.progressA11y', { title: task.title })}
            target={task.progress.target}
            testID={`reward-task-progress-bar-${task.id}`}
          />
        </View>
      ) : null}

      <View style={styles.bottomRow}>
        <View style={styles.statusChip}>
          <Text style={styles.statusText} testID={`reward-task-status-${task.id}`}>
            {t(STATUS_LABEL_KEY[task.status])}
          </Text>
        </View>
        <RewardCta
          isSupported={task.isClaimSupported}
          label={task.ctaLabel}
          onPress={() => onPressCta(task)}
          testID={`reward-task-cta-${task.id}`}
        />
      </View>

      {!task.isClaimSupported && showUnsupportedNotice ? (
        <RewardNotice
          message={t(UNSUPPORTED_TASK_MESSAGE_KEY[task.type])}
          testID={`reward-task-notice-${task.id}`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  mark: {
    // min-, not fixed: the glyphs scale with the OS text-size setting and
    // a fixed 40x40 box clips them outright at the largest sizes.
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  markText: {
    fontSize: 12,
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
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
    gap: 6,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  progressValue: {
    fontSize: 12,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  statusText: {
    fontSize: 11,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
});
