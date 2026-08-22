import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  PointsPill,
  RewardCta,
  RewardProgressBar,
} from '@/features/rewards/components/rewards-primitives';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardAccent, RewardSurface, scaledLineHeight } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';
import type { RewardTask, RewardTaskType, SocialPlatform } from '@/types/rewards';

/**
 * One task row: mark, what it is, what it pays, and one control.
 *
 * Every task type renders through this single path - a social follow, a
 * rewarded ad and a future campaign differ only in their data.
 *
 * The row is arranged the way the reference design arranges it: the reward
 * sits on the TITLE line rather than in the trailing column, so a user
 * scanning five rows reads "Facebook +50" as one phrase and the buttons
 * stay on a clean right edge.
 *
 * Pressing the CTA calls `onPressCta` and does nothing else. There is no
 * award, no claim, no local counter increment, and no navigation to a
 * social app or ad unit.
 */

type TaskMark = {
  /** A plain glyph, never a traced or embedded brand logo. */
  readonly glyph: string;
  readonly background: string;
  readonly border: string;
  readonly color: string;
};

/**
 * Brand-TINTED tiles carrying a plain glyph.
 *
 * This repo ships no licensed brand assets and must not fake one, so the
 * mark follows the precedent already set by `AuthProviderButton`: the
 * provider's colour plus a neutral letter or shape, never an imitation of an
 * official logo. Colour is what makes the five rows scannable at a glance;
 * the glyph is a second, redundant cue for anyone who cannot use it.
 *
 * These tiles are DECORATIVE - the row title beside each one names the
 * platform, and both platform accessibility flags hide the tile outright.
 */
const PLATFORM_MARK: Record<SocialPlatform, TaskMark> = {
  FACEBOOK: { glyph: 'f', background: '#1877F2', border: '#3B8CF4', color: '#FFFFFF' },
  YOUTUBE: { glyph: '▶', background: '#E62117', border: '#F2453B', color: '#FFFFFF' },
  TIKTOK: { glyph: '♪', background: '#0B0B0F', border: '#3A3A44', color: '#FFFFFF' },
  INSTAGRAM: { glyph: '◎', background: '#C13584', border: '#D45BA0', color: '#FFFFFF' },
};

const TYPE_MARK: Record<RewardTaskType, TaskMark> = {
  // Reached only if a social task arrives without a platform. A neutral
  // share glyph rather than a letter, which would read as a brand initial.
  SOCIAL_FOLLOW: {
    glyph: '✦',
    background: RewardSurface.chip,
    border: RewardSurface.chipBorder,
    color: Palette.text,
  },
  REWARDED_AD: {
    glyph: '▷',
    background: 'rgba(255, 122, 26, 0.16)',
    border: 'rgba(255, 122, 26, 0.42)',
    color: Palette.primaryHover,
  },
  WATCH_TIME: {
    glyph: '⏱',
    background: RewardSurface.chip,
    border: RewardSurface.chipBorder,
    color: Palette.text,
  },
  // Language-neutral on purpose. These marks are NOT localized, so an
  // Indonesian word like "MISI" would appear verbatim in the English and
  // Chinese UI.
  CAMPAIGN: {
    glyph: '★',
    background: RewardAccent.goldSoft,
    border: RewardAccent.goldBorder,
    color: RewardAccent.gold,
  },
  DAILY_CHECK_IN: {
    glyph: '✓',
    background: RewardAccent.goldSoft,
    border: RewardAccent.goldBorder,
    color: RewardAccent.gold,
  },
};

type RewardTaskCardProps = {
  readonly task: RewardTask;
  readonly onPressCta: (task: RewardTask) => void;
};

export function RewardTaskCard({ task, onPressCta }: RewardTaskCardProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();
  const mark = task.socialPlatform ? PLATFORM_MARK[task.socialPlatform] : TYPE_MARK[task.type];

  return (
    <View style={styles.row} testID={`rewards-task-${task.id}`}>
      {/* Decorative: the title beside it already names the task. Both props
          are needed - `importantForAccessibility` is Android-only and
          `accessibilityElementsHidden` is iOS-only, so setting one alone
          leaves a reader announcing a stray glyph. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.mark, { backgroundColor: mark.background, borderColor: mark.border }]}
        testID={`rewards-task-mark-${task.id}`}>
        <Text style={[styles.markText, { color: mark.color }]}>{mark.glyph}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          {/* Wraps rather than truncates: the row is narrow once the mark,
              the reward pill and the CTA have taken their width, and a task
              the user cannot read the name of is not scannable. The title
              row wraps, so a long name pushes the pill onto its own line. */}
          <Text style={styles.title}>{task.title}</Text>
          <PointsPill points={task.rewardPoints} testID={`rewards-task-points-${task.id}`} />
        </View>
        <Text style={styles.description}>{task.description}</Text>

        {task.progress ? (
          <View style={styles.progressBlock}>
            <RewardProgressBar
              current={task.progress.current}
              label={t('rewards.progressA11y', { title: task.title })}
              target={task.progress.target}
              testID={`rewards-task-progress-bar-${task.id}`}
            />
            <Text style={styles.progressValue} testID={`rewards-task-progress-${task.id}`}>
              {t('rewards.progressShort', {
                current: formatPoints(task.progress.current),
                target: formatPoints(task.progress.target),
              })}
            </Text>
          </View>
        ) : null}
      </View>

      <RewardCta
        // Three of the five rows ship the same CTA word, so the announced
        // name carries the task it belongs to ("Follow: TikTok").
        accessibilityLabel={t('rewards.ctaA11y', { label: task.ctaLabel, title: task.title })}
        compact
        isSupported={task.isClaimSupported}
        label={task.ctaLabel}
        onPress={() => onPressCta(task)}
        testID={`rewards-task-cta-${task.id}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: RewardSurface.cardBorder,
    borderRadius: Radius.xl,
    backgroundColor: RewardSurface.card,
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
  },
  markText: {
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  title: {
    flexShrink: 1,
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
});
