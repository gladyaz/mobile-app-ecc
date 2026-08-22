import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  CoinMark,
  PointsPill,
  RewardCta,
  RewardsCard,
} from '@/features/rewards/components/rewards-primitives';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardAccent, RewardSurface, scaledLineHeight } from '@/features/rewards/rewards-theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type { DailyCheckIn, DailyCheckInDay } from '@/types/rewards';

/**
 * Daily check-in progression, compact form.
 *
 * The day strip renders whatever `checkIn.days` contains - 7 entries is the
 * backend's current cycle, not this component's assumption. A 14- or 30-day
 * curve renders without a code change, which is why the strip scrolls
 * horizontally rather than assuming seven chips fit a phone width.
 *
 * Each day's `state` is supplied by the model. This component never derives
 * "is today claimed" from a device clock: the daily boundary and the streak
 * are server decisions (see `docs/rewards-domain-contract.md`).
 *
 * THE STREAK BONUS LINE IS DERIVED, NOT WRITTEN. The reference design ends
 * this card with "check in 7 days in a row for a +200 bonus". Those two
 * numbers are not copy - they are read off the day the SERVER flagged
 * `isBonus`, using that day's own `day` and `rewardPoints`. A cycle with no
 * bonus day renders no line at all, rather than a sentence promising a
 * bonus this deployment does not pay.
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
  const formatPoints = useFormatPoints();
  const isToday = day.state === 'TODAY';
  const isClaimed = day.state === 'CLAIMED';
  const isUpcoming = day.state === 'UPCOMING';

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
        day.isBonus && !isToday && styles.dayChipBonus,
        isToday && styles.dayChipToday,
      ]}
      testID={`rewards-check-in-day-${day.day}`}>
      <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
        {t('rewards.dayLabel', { day: day.day })}
      </Text>
      <CoinMark isMuted={isUpcoming} size={17} />
      <Text style={[styles.dayPoints, isUpcoming && styles.dayPointsUpcoming]}>
        {formatPoints(day.rewardPoints)}
      </Text>
      {/* State is never carried by colour alone - every chip also has a word.
          "Today" outranks "Bonus" so the today cue is never lost on a day
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
  /** The check-in request is in flight. Blocks a second press. */
  readonly isPending?: boolean;
};

export function DailyCheckInCard({
  checkIn,
  onPressCta,
  isPending = false,
}: DailyCheckInCardProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();
  const isClaimable = checkIn.isClaimSupported && !checkIn.isTodayClaimed;
  // Read off the server's own cycle. `undefined` when this deployment
  // configures no bonus day, which renders no bonus sentence.
  const bonusDay = checkIn.days.find((day) => day.isBonus);

  return (
    <RewardsCard testID="rewards-daily-check-in">
      <ScrollView
        contentContainerStyle={styles.dayStrip}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {checkIn.days.map((day) => (
          <DayChip day={day} key={day.day} />
        ))}
      </ScrollView>

      {/* Shown only while today is still UNCLAIMED. Once the CTA itself reads
          "sudah check-in hari ini" this row would restate a past event, and
          the day strip already carries every amount in the cycle. It does not
          depend on `isClaimSupported`: the amount is what the server says
          today pays either way, and the CTA is what states availability. */}
      {checkIn.isTodayClaimed ? null : (
        <View style={styles.todayRow}>
          <Text style={styles.todayLabel}>{t('rewards.todayReward')}</Text>
          <PointsPill points={checkIn.todayRewardPoints} testID="check-in-today-reward" />
        </View>
      )}

      {/* Two SERVER facts, and only server facts, decide whether this button
          is live: whether the backend supports claiming at all, and whether
          it has already paid today. Neither is inferred from the device
          clock - the reward day is defined by the service timezone, so a
          phone whose clock is moved forward gets the same answer. */}
      <RewardCta
        fullWidth
        isPending={isPending}
        isSupported={isClaimable}
        label={checkIn.ctaLabel}
        onPress={onPressCta}
        testID="rewards-check-in"
        tone="primary"
      />

      {bonusDay ? (
        <Text style={styles.bonusHint} testID="rewards-check-in-bonus">
          {t('rewards.checkInBonusHint', {
            days: bonusDay.day,
            points: formatPoints(bonusDay.rewardPoints),
          })}
        </Text>
      ) : null}
    </RewardsCard>
  );
}

const styles = StyleSheet.create({
  dayStrip: {
    gap: 8,
    paddingVertical: 2,
  },
  dayChip: {
    // min-, not fixed, so the stacked labels can grow with the OS text-size
    // setting instead of wrapping inside a narrow column.
    minWidth: 58,
    paddingHorizontal: 7,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: RewardSurface.chipBorder,
    backgroundColor: RewardSurface.chip,
  },
  dayChipClaimed: {
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  dayChipBonus: {
    borderColor: RewardAccent.goldBorder,
  },
  dayChipToday: {
    // The one chip that reads as "act here": a warm ring plus a warm fill,
    // rather than the solid gold block the previous pass used - a filled
    // chip beside a filled CTA gave the card two competing focal points.
    borderColor: Palette.primary,
    backgroundColor: 'rgba(255, 122, 26, 0.14)',
  },
  dayLabel: {
    fontSize: 10.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  dayLabelToday: {
    color: Palette.primaryHover,
  },
  dayPoints: {
    fontSize: 14.5,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  dayPointsUpcoming: {
    color: Palette.textSecondary,
  },
  dayState: {
    fontSize: 9.5,
    letterSpacing: 0.2,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  dayStateToday: {
    color: Palette.primaryHover,
  },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  todayLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  bonusHint: {
    fontSize: 11.5,
    lineHeight: scaledLineHeight(11.5),
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
});
