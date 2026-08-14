import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  RewardCta,
  RewardProgressBar,
  RewardsCard,
} from '@/features/rewards/components/rewards-primitives';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardAccent } from '@/features/rewards/rewards-theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type {
  WatchTimeMilestone,
  WatchTimeMilestoneStatus,
  WatchTimeProgress,
} from '@/types/rewards';

/**
 * Watch-time milestones: progress, then tiers, then what each tier pays.
 *
 * IMPORTANT - there is no timer in this file, and there must never be one.
 * `watchedMinutes` is displayed exactly as supplied. A client-side stopwatch
 * is manipulable (system clock, backgrounded app, patched bundle) and can
 * never be the basis of a real award; production progress has to come from
 * server-side watch analytics. `WatchTimeProgressSource` has no
 * `LOCAL_TIMER` member for exactly this reason, and a test asserts this
 * feature schedules no timer at all.
 *
 * The UX pass removed the paragraph that explained all of the above to the
 * user. It was true, but it was engineering rationale sitting in a consumer
 * screen; it now lives here, in the tests, and in the domain contract, while
 * the page-level preview banner tells the user the one thing they need.
 */

const MILESTONE_STATE_LABEL_KEY: Record<WatchTimeMilestoneStatus, TranslationKey> = {
  CLAIMED: 'rewards.milestoneClaimed',
  REACHED: 'rewards.milestoneReached',
  LOCKED: 'rewards.milestoneLocked',
};

type MilestoneChipProps = {
  readonly milestone: WatchTimeMilestone;
};

function MilestoneChip({ milestone }: MilestoneChipProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();
  const isReached = milestone.status === 'REACHED';
  const isClaimed = milestone.status === 'CLAIMED';

  return (
    <View
      accessible
      accessibilityLabel={t('rewards.milestoneA11y', {
        minutes: milestone.minutes,
        points: formatPoints(milestone.rewardPoints),
        state: t(MILESTONE_STATE_LABEL_KEY[milestone.status]).toLowerCase(),
      })}
      style={[styles.chip, isClaimed && styles.chipClaimed, isReached && styles.chipReached]}
      testID={`watch-time-milestone-${milestone.id}`}>
      <Text style={styles.chipMinutes}>
        {t('rewards.minutesShort', { minutes: milestone.minutes })}
      </Text>
      <Text style={styles.chipPoints}>+{formatPoints(milestone.rewardPoints)}</Text>
      {/* Status is never carried by color alone - every chip has a word. */}
      <Text style={styles.chipState}>{t(MILESTONE_STATE_LABEL_KEY[milestone.status])}</Text>
    </View>
  );
}

type WatchTimeCardProps = {
  readonly watchTime: WatchTimeProgress;
  readonly onPressCta: () => void;
};

export function WatchTimeCard({ watchTime, onPressCta }: WatchTimeCardProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();
  // The bar spans up to the largest configured milestone. Derived from the
  // supplied milestones, so a re-tuned curve needs no code change here.
  const finalMinutes = watchTime.milestones.reduce(
    (highest, milestone) => Math.max(highest, milestone.minutes),
    0
  );

  return (
    <RewardsCard testID="rewards-watch-time">
      <View style={styles.summaryRow}>
        {/* An empty milestone list is type-legal, and "7 of 0 minutes" is
            self-contradictory - so the target half is dropped entirely
            rather than rendered as a zero. */}
        <Text style={styles.summaryValue} testID="watch-time-watched-minutes">
          {finalMinutes > 0
            ? t('rewards.watchSummary', {
                current: formatPoints(watchTime.watchedMinutes),
                target: formatPoints(finalMinutes),
              })
            : t('rewards.watchSummaryNoTarget', {
                current: formatPoints(watchTime.watchedMinutes),
              })}
        </Text>
        <RewardCta
          compact
          isSupported={watchTime.isClaimSupported}
          label={t('rewards.watchTimeCta')}
          onPress={onPressCta}
          testID="watch-time-cta"
        />
      </View>

      <RewardProgressBar
        current={watchTime.watchedMinutes}
        label={t('rewards.watchProgressA11y')}
        target={finalMinutes}
        testID="watch-time-progress-bar"
      />

      <ScrollView
        contentContainerStyle={styles.chipStrip}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {watchTime.milestones.map((milestone) => (
          <MilestoneChip key={milestone.id} milestone={milestone} />
        ))}
      </ScrollView>
    </RewardsCard>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  chipStrip: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    minWidth: 70,
    flexShrink: 0,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  chipClaimed: {
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  chipReached: {
    borderColor: RewardAccent.gold,
  },
  chipMinutes: {
    fontSize: 12.5,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  chipPoints: {
    fontSize: 11.5,
    fontFamily: FontFamily.bold,
    color: RewardAccent.gold,
  },
  chipState: {
    fontSize: 9.5,
    letterSpacing: 0.2,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
});
