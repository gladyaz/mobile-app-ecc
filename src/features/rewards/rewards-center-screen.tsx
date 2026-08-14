import { useCallback, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { DailyCheckInCard } from '@/features/rewards/components/daily-check-in-card';
import { EarnPanel } from '@/features/rewards/components/earn-panel';
import { PointsBalanceCard } from '@/features/rewards/components/points-balance-card';
import { RedeemPanel } from '@/features/rewards/components/redeem-panel';
import {
  PreviewBadge,
  PreviewBanner,
  RewardEmptyState,
  RewardsSection,
} from '@/features/rewards/components/rewards-primitives';
import { WatchTimeCard } from '@/features/rewards/components/watch-time-card';
import { buildFixtureRewardsSnapshot } from '@/features/rewards/rewards-fixtures';
import { scaledLineHeight } from '@/features/rewards/rewards-theme';
import { useTranslation, type Translate } from '@/stores/language';
import type { RewardsPrototypeAction, RewardsViewState } from '@/types/rewards';

/**
 * Rewards Center.
 *
 * INFORMATION ARCHITECTURE - one scroll, five blocks, in the order a
 * first-time user asks the questions:
 *   1. balance hero      -> "how many points do I have?"
 *   2. Daily Reward      -> "what can I do today?"
 *   3. Earn Points       -> "how do I get more?"
 *   4. Watch Rewards     -> "...and by watching?"
 *   5. Redeem            -> "what is this worth eventually?"
 *
 * The previous layout split these across an Earn/Redeem tab pair, which
 * meant the answer to question 5 was one tap out of sight and questions 2-4
 * shared a single heading. Tabs are gone; each block now has its own
 * heading, and the whole reward loop reads top to bottom.
 *
 * WHAT THIS SCREEN DOES NOT DO - and must not start doing without the
 * backend contract in `docs/rewards-domain-contract.md` being implemented
 * first:
 *   - it never mutates a points balance, locally or remotely
 *   - it never claims a task or marks a check-in
 *   - it never touches the entitlement system
 *   - it never starts an ad, opens a social link, or runs a watch timer
 *
 * The only state it owns is `pendingAction`: which CTA the user last
 * tapped, so a press is acknowledged rather than silently ignored.
 */

function describePendingAction(t: Translate, action: RewardsPrototypeAction): string {
  return t('rewards.actionUnavailable', { label: action.label });
}

type ActionBannerProps = {
  readonly action: RewardsPrototypeAction;
  readonly onDismiss: () => void;
};

/**
 * Feedback for a tap on a preview-only control. One short sentence - the
 * "why" is already stated once at the top of the page, and repeating the
 * full explanation on every press is what made the old screen feel like it
 * was arguing with the user.
 */
function ActionBanner({ action, onDismiss }: ActionBannerProps) {
  const { t } = useTranslation();

  return (
    <View
      // Android announces this through the live region. iOS has no
      // equivalent prop, so `RewardsCenterScreen` pushes the same sentence
      // through `AccessibilityInfo.announceForAccessibility` there - without
      // it, a VoiceOver user who taps a CTA further down the scroll view
      // gets no feedback at all.
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={styles.actionBanner}
      testID="rewards-action-banner">
      <Text style={styles.actionBannerText}>{describePendingAction(t, action)}</Text>
      <Pressable
        accessibilityLabel={t('rewards.dismissNotice')}
        accessibilityRole="button"
        onPress={onDismiss}
        style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
        testID="rewards-action-banner-dismiss">
        <Text style={styles.dismissButtonText}>{t('rewards.dismiss')}</Text>
      </Pressable>
    </View>
  );
}

export type RewardsCenterScreenProps = {
  /**
   * Defaults to the placeholder snapshot so the screen is renderable before
   * any service exists.
   *
   * INTEGRATION NOTE: when a real rewards service lands, make this prop
   * REQUIRED and delete the default. Otherwise a caller that forgets to
   * thread real state silently ships a plausible-looking balance.
   */
  readonly state?: RewardsViewState;
  readonly onRetry?: () => void;
  /** When provided, renders a back control. Omitted = tab root. */
  readonly onClose?: () => void;
  readonly onPrototypeAction?: (action: RewardsPrototypeAction) => void;
};

export function RewardsCenterScreen({
  state,
  onRetry,
  onClose,
  onPrototypeAction,
}: RewardsCenterScreenProps) {
  const { t } = useTranslation();
  const [pendingAction, setPendingAction] = useState<RewardsPrototypeAction | null>(null);
  // Built per language rather than read from a module constant, so switching
  // the app language re-renders the preview copy with everything else.
  const resolvedState: RewardsViewState = state ?? {
    status: 'ready',
    snapshot: buildFixtureRewardsSnapshot(t),
  };

  const handlePrototypeAction = useCallback(
    (action: RewardsPrototypeAction) => {
      // The entire effect of every CTA on this screen. No balance, no claim,
      // no entitlement - just a record of what was tapped, an announcement
      // for screen-reader users, plus an optional notification to the host.
      setPendingAction(action);

      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(describePendingAction(t, action));
      }

      onPrototypeAction?.(action);
    },
    [onPrototypeAction, t]
  );

  return (
    <View style={styles.container} testID="rewards-center-screen">
      <View style={styles.header}>
        {onClose ? (
          <Pressable
            accessibilityLabel={t('rewards.back')}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            testID="rewards-back-button">
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
        ) : null}
        {/* The page-level heading, so a rotor/heading walk starts here
            rather than jumping straight to the first section. */}
        <Text accessibilityRole="header" style={styles.title}>
          {t('rewards.title')}
        </Text>
        <PreviewBadge />
      </View>

      {resolvedState.status === 'loading' ? (
        <View style={styles.centered} testID="rewards-loading">
          <ActivityIndicator color={Palette.primary} size="large" />
          <Text style={styles.centeredText}>{t('rewards.loading')}</Text>
        </View>
      ) : resolvedState.status === 'error' ? (
        <View style={styles.centered} testID="rewards-error">
          <Text style={styles.errorText}>{resolvedState.message}</Text>
          {onRetry ? (
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              testID="rewards-retry-button">
              <Text style={styles.retryButtonText}>{t('rewards.retry')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* The one place the preview status is explained. */}
          <PreviewBanner />

          <PointsBalanceCard
            streakDays={resolvedState.snapshot.dailyCheckIn?.currentStreakDays ?? null}
            wallet={resolvedState.snapshot.wallet}
          />

          {pendingAction ? (
            <ActionBanner action={pendingAction} onDismiss={() => setPendingAction(null)} />
          ) : null}

          <RewardsSection title={t('rewards.sectionDaily')} testID="rewards-section-daily">
            {resolvedState.snapshot.dailyCheckIn ? (
              <DailyCheckInCard
                checkIn={resolvedState.snapshot.dailyCheckIn}
                onPressCta={() =>
                  handlePrototypeAction({
                    kind: 'DAILY_CHECK_IN',
                    id: 'daily_check_in',
                    label: resolvedState.snapshot.dailyCheckIn?.ctaLabel ?? '',
                  })
                }
              />
            ) : (
              <RewardEmptyState
                message={t('rewards.checkInEmpty')}
                testID="rewards-check-in-empty"
              />
            )}
          </RewardsSection>

          <RewardsSection title={t('rewards.sectionEarn')} testID="rewards-section-earn">
            <EarnPanel onAction={handlePrototypeAction} tasks={resolvedState.snapshot.tasks} />
          </RewardsSection>

          <RewardsSection title={t('rewards.sectionWatch')} testID="rewards-section-watch">
            {resolvedState.snapshot.watchTime ? (
              <WatchTimeCard
                onPressCta={() =>
                  handlePrototypeAction({
                    kind: 'WATCH_TIME',
                    id: 'watch_time',
                    label: t('rewards.watchTimeCta'),
                  })
                }
                watchTime={resolvedState.snapshot.watchTime}
              />
            ) : (
              <RewardEmptyState
                message={t('rewards.watchTimeEmpty')}
                testID="rewards-watch-time-empty"
              />
            )}
          </RewardsSection>

          <RewardsSection title={t('rewards.sectionRedeem')} testID="rewards-section-redeem">
            <RedeemPanel
              onAction={handlePrototypeAction}
              redemptions={resolvedState.snapshot.redemptions}
            />
          </RewardsSection>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 70,
    paddingBottom: 12,
  },
  backButton: {
    // min-, not fixed: the chevron scales with the OS text-size setting.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  backButtonText: {
    fontSize: 26,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    // Sections breathe more than the cards inside them, which is what makes
    // the five blocks readable as five blocks.
    gap: 22,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingBottom: 80,
  },
  centeredText: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  errorText: {
    fontSize: 13.5,
    lineHeight: scaledLineHeight(13.5),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  retryButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
  },
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 26, 0.35)',
    backgroundColor: 'rgba(255, 122, 26, 0.09)',
  },
  actionBannerText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: scaledLineHeight(12.5),
    fontFamily: FontFamily.semiBold,
    color: Palette.primaryHover,
  },
  dismissButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dismissButtonText: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
  },
  pressed: {
    opacity: 0.75,
  },
});
