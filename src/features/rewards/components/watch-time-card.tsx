import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  RewardCta,
  RewardNotice,
  RewardProgressBar,
  RewardsCard,
} from '@/features/rewards/components/rewards-primitives';
import { formatPoints } from '@/features/rewards/format-points';
import { RewardAccent } from '@/features/rewards/rewards-theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type {
  WatchTimeMilestone,
  WatchTimeMilestoneStatus,
  WatchTimeProgress,
} from '@/types/rewards';

/**
 * Watch-time milestone progress.
 *
 * IMPORTANT - there is no timer in this file, and there must never be one.
 * `watchedMinutes` is displayed exactly as supplied. A client-side stopwatch
 * is manipulable (system clock, backgrounded app, patched bundle) and can
 * never be the basis of a real award; production progress has to come from
 * server-side watch analytics. See "Watch-time" in
 * `docs/rewards-domain-contract.md`.
 *
 * `source` makes that visible to the user: anything other than 'SERVER'
 * renders a caveat instead of quietly passing fixture data off as tracked
 * viewing time.
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
  const isReached = milestone.status === 'REACHED';
  const isClaimed = milestone.status === 'CLAIMED';
  const stateLabel = t(MILESTONE_STATE_LABEL_KEY[milestone.status]);

  return (
    <View
      accessible
      // toLocaleLowerCase() (not toLowerCase) so the spoken label lowercases
      // correctly in every app language; it is a no-op for Chinese, which
      // has no letter case at all.
      accessibilityLabel={t('rewards.milestoneA11y', {
        minutes: milestone.minutes,
        points: formatPoints(milestone.rewardPoints),
        state: stateLabel.toLocaleLowerCase(),
      })}
      style={[styles.chip, isClaimed && styles.chipClaimed, isReached && styles.chipReached]}
      testID={`watch-time-milestone-${milestone.id}`}>
      <Text style={styles.chipMinutes}>
        {t('rewards.minutesShort', { minutes: milestone.minutes })}
      </Text>
      <Text style={styles.chipPoints}>
        {t('rewards.pointsValue', { points: formatPoints(milestone.rewardPoints) })}
      </Text>
      <Text style={styles.chipState}>{stateLabel}</Text>
    </View>
  );
}

type WatchTimeCardProps = {
  readonly watchTime: WatchTimeProgress;
  readonly onPressCta: () => void;
};

export function WatchTimeCard({ watchTime, onPressCta }: WatchTimeCardProps) {
  const { t } = useTranslation();
  // The bar spans up to the largest configured milestone. Derived from the
  // supplied milestones, so a re-tuned curve needs no code change here.
  const finalMinutes = watchTime.milestones.reduce(
    (highest, milestone) => Math.max(highest, milestone.minutes),
    0
  );

  return (
    <RewardsCard
      caption={t('rewards.watchTimeCaption')}
      testID="rewards-watch-time"
      title={t('rewards.watchTimeTitle')}>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryValue} testID="watch-time-watched-minutes">
          {t('rewards.watchedMinutes', { minutes: formatPoints(watchTime.watchedMinutes) })}
        </Text>
        {/* An empty milestone list is type-legal; "dari 0 menit" would be
            nonsense, so the target half is simply omitted. */}
        {finalMinutes > 0 ? (
          <Text style={styles.summaryTarget}>
            {t('rewards.watchTarget', { minutes: formatPoints(finalMinutes) })}
          </Text>
        ) : null}
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

      <RewardCta
        isSupported={watchTime.isClaimSupported}
        label={t('rewards.watchTimeCta')}
        onPress={onPressCta}
        testID="watch-time-cta"
      />

      {watchTime.source === 'SERVER' && watchTime.isClaimSupported ? null : (
        <RewardNotice message={t('rewards.watchTimePlaceholderSource')} testID="watch-time-notice" />
      )}
    </RewardsCard>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  summaryValue: {
    fontSize: 22,
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  summaryTarget: {
    fontSize: 12,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  chipStrip: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    minWidth: 78,
    flexShrink: 0,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 10,
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
    fontSize: 13,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  chipPoints: {
    fontSize: 11,
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
