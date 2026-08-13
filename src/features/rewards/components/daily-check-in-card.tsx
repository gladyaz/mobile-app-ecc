import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  PointsPill,
  RewardCta,
  RewardNotice,
  RewardsCard,
} from '@/features/rewards/components/rewards-primitives';
import { formatPoints } from '@/features/rewards/format-points';
import { RewardAccent } from '@/features/rewards/rewards-theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type { DailyCheckIn, DailyCheckInDay } from '@/types/rewards';

/**
 * Daily check-in progression.
 *
 * The day strip renders whatever `checkIn.days` contains - 7 entries is the
 * fixture's choice, not this component's. A 14- or 30-day curve renders
 * without a code change, which is why the strip scrolls horizontally rather
 * than assuming seven chips fit a phone width.
 *
 * Each day's `state` is supplied by the model. This component never derives
 * "is today claimed" from a device clock: the daily boundary and the streak
 * are server decisions (see `docs/rewards-domain-contract.md`).
 */

const DAY_STATE_SUFFIX_KEY: Record<DailyCheckInDay['state'], TranslationKey> = {
  CLAIMED: 'rewards.dayStateClaimed',
  TODAY: 'rewards.dayStateToday',
  UPCOMING: 'rewards.dayStateUpcoming',
};

type DayChipProps = {
  readonly day: DailyCheckInDay;
};

function DayChip({ day }: DayChipProps) {
  const { t } = useTranslation();
  const isToday = day.state === 'TODAY';
  const isClaimed = day.state === 'CLAIMED';

  return (
    <View
      accessible
      accessibilityLabel={t('rewards.dayChipA11y', {
        day: day.day,
        points: formatPoints(day.rewardPoints),
        state: t(DAY_STATE_SUFFIX_KEY[day.state]),
        bonus: day.isBonus ? t('rewards.bonusSuffix') : '',
      })}
      style={[
        styles.dayChip,
        isClaimed && styles.dayChipClaimed,
        isToday && styles.dayChipToday,
        day.isBonus && !isToday && styles.dayChipBonus,
      ]}
      testID={`check-in-day-${day.day}`}>
      <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
        {t('rewards.dayLabel', { day: day.day })}
      </Text>
      <Text style={[styles.dayPoints, isToday && styles.dayPointsToday]}>
        {formatPoints(day.rewardPoints)}
      </Text>
      {/* State is never carried by color alone - every chip also has a word.
          "Hari ini" outranks "Bonus" so the today cue is never lost on a day
          that happens to be both. */}
      <Text style={[styles.dayState, isToday && styles.dayStateToday]}>
        {isClaimed
          ? t('rewards.dayDone')
          : isToday
            ? t('rewards.dayToday')
            : day.isBonus
              ? t('rewards.dayBonus')
              : t('rewards.dayLater')}
      </Text>
    </View>
  );
}

type DailyCheckInCardProps = {
  readonly checkIn: DailyCheckIn;
  readonly onPressCta: () => void;
};

export function DailyCheckInCard({ checkIn, onPressCta }: DailyCheckInCardProps) {
  const { t } = useTranslation();

  return (
    <RewardsCard
      caption={checkIn.resetsAtLabel}
      testID="rewards-daily-check-in"
      title={t('rewards.checkInTitle')}>
      {/* Grouped so a screen reader announces two facts, not four fragments
          ("6", "hari beruntun", "19", "rekor terpanjang"). */}
      <View style={styles.streakRow}>
        <View
          accessible
          accessibilityLabel={t('rewards.streakCurrentA11y', { days: checkIn.currentStreakDays })}
          style={styles.streakItem}>
          <Text style={styles.streakValue} testID="check-in-current-streak">
            {checkIn.currentStreakDays}
          </Text>
          <Text style={styles.streakLabel}>{t('rewards.streakCurrentLabel')}</Text>
        </View>
        <View style={styles.streakDivider} />
        <View
          accessible
          accessibilityLabel={t('rewards.streakLongestA11y', { days: checkIn.longestStreakDays })}
          style={styles.streakItem}>
          <Text style={styles.streakValueMuted} testID="check-in-longest-streak">
            {checkIn.longestStreakDays}
          </Text>
          <Text style={styles.streakLabel}>{t('rewards.streakLongestLabel')}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.dayStrip}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {checkIn.days.map((day) => (
          <DayChip day={day} key={day.day} />
        ))}
      </ScrollView>

      <View style={styles.todayRow}>
        <View style={styles.todayText}>
          <Text style={styles.todayLabel}>{t('rewards.todayReward')}</Text>
          <Text style={styles.todayStatus}>
            {checkIn.isTodayClaimed
              ? t('rewards.checkedInToday')
              : t('rewards.notCheckedInToday')}
          </Text>
        </View>
        <PointsPill points={checkIn.todayRewardPoints} testID="check-in-today-reward" />
      </View>

      <RewardCta
        isSupported={checkIn.isClaimSupported}
        label={checkIn.ctaLabel}
        onPress={onPressCta}
        testID="check-in-cta"
      />

      {checkIn.isClaimSupported ? null : (
        <RewardNotice message={t('rewards.checkInUnverified')} testID="check-in-notice" />
      )}
    </RewardsCard>
  );
}

const styles = StyleSheet.create({
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  streakItem: {
    gap: 1,
  },
  streakDivider: {
    width: 1,
    height: 28,
    backgroundColor: Palette.border,
  },
  streakValue: {
    fontSize: 24,
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  streakValueMuted: {
    fontSize: 24,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  streakLabel: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  dayStrip: {
    gap: 8,
    paddingVertical: 2,
  },
  dayChip: {
    // min-, not fixed, so the three stacked labels can grow with the OS
    // text-size setting instead of wrapping inside a 66pt column. Matches
    // the sibling milestone chip in watch-time-card.tsx.
    minWidth: 66,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  dayChipClaimed: {
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  dayChipToday: {
    borderColor: RewardAccent.gold,
    backgroundColor: RewardAccent.gold,
  },
  dayChipBonus: {
    borderColor: RewardAccent.goldBorder,
  },
  dayLabel: {
    fontSize: 10.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  dayLabelToday: {
    color: 'rgba(13, 13, 15, 0.75)',
  },
  dayPoints: {
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  dayPointsToday: {
    color: Palette.background,
  },
  dayState: {
    fontSize: 9.5,
    letterSpacing: 0.2,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  dayStateToday: {
    color: 'rgba(13, 13, 15, 0.75)',
  },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  todayText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  todayLabel: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  todayStatus: {
    fontSize: 11.5,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
});
