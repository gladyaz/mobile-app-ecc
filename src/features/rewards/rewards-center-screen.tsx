import { useCallback, useEffect, useState } from 'react';
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
import { TransactionHistoryPanel } from '@/features/rewards/components/transaction-history-panel';
import { WatchTimeCard } from '@/features/rewards/components/watch-time-card';
import { scaledLineHeight } from '@/features/rewards/rewards-theme';
import { useTranslation, type Translate } from '@/stores/language';
import type {
  DailyCheckIn,
  RewardRedemption,
  RewardsLedgerState,
  RewardsNotice,
  RewardsUnavailableAction,
  RewardsViewState,
} from '@/types/rewards';

/**
 * Rewards Center.
 *
 * INFORMATION ARCHITECTURE - one scroll, six blocks, in the order a
 * first-time user asks the questions:
 *   1. balance hero      -> "how many points do I have?"
 *   2. Daily Reward      -> "what can I do today?"
 *   3. Earn Points       -> "how do I get more?"
 *   4. Watch Rewards     -> "...and by watching?"
 *   5. Redeem            -> "what is this worth?"
 *   6. Point History     -> "where did my points go?"
 *
 * THIS SCREEN IS PRESENTATIONAL. It fetches nothing, decides no
 * availability, and computes no balance. Every number and every
 * enabled/disabled flag arrives on `state`, which the route builds from
 * `useRewardsCenter()`. There is deliberately no default `state` and no
 * fixture import: a caller that forgets to thread real state gets a type
 * error, not a plausible-looking balance.
 *
 * WHAT IT MAY AND MAY NOT DO:
 *   - it never mutates a balance; a CTA calls back to the container, and
 *     the container renders whatever the SERVER then says
 *   - it never touches the entitlement system
 *   - it never composes a history row from an action that just happened -
 *     `ledger` is the server's ledger, re-read
 *   - it never re-enables a control the server marked unsupported
 *
 * THE PREVIEW CHROME IS CONDITIONAL, NOT DELETED. `PreviewBadge`,
 * `PreviewBanner` and the balance's preview tag render only while
 * `wallet.isServerAuthoritative` is false - which, against the real backend,
 * is never, because it always sends `true`. Removing them outright would
 * leave a non-authoritative balance (should one ever reach this screen)
 * rendered as though it were real, which is the exact failure the flag
 * exists to prevent.
 */

function describeUnavailableAction(t: Translate, action: RewardsUnavailableAction): string {
  return t('rewards.actionUnavailable', { label: action.label });
}

type NoticeBannerProps = {
  readonly notice: RewardsNotice;
  readonly onDismiss: () => void;
};

/**
 * The screen's single feedback line: what the server just did, or why a
 * control did nothing. One short sentence - the previous layout repeated a
 * paragraph of rationale beside every card, which read as a debug screen.
 */
function NoticeBanner({ notice, onDismiss }: NoticeBannerProps) {
  const { t } = useTranslation();

  return (
    <View
      // Android announces this through the live region. iOS has no
      // equivalent prop, so `RewardsCenterScreen` pushes the same sentence
      // through `AccessibilityInfo.announceForAccessibility` there - without
      // it, a VoiceOver user who acts on a control further down the scroll
      // view gets no confirmation at all.
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.actionBanner, notice.tone === 'success' && styles.actionBannerSuccess]}
      testID="rewards-action-banner">
      <Text
        style={[styles.actionBannerText, notice.tone === 'success' && styles.actionBannerTextSuccess]}>
        {notice.message}
      </Text>
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
   * REQUIRED, with no default. The previous slice defaulted to a fixture
   * snapshot so the screen was renderable before a service existed; that
   * default is gone precisely so it can never be reached again.
   */
  readonly state: RewardsViewState;
  readonly ledger: RewardsLedgerState;
  /** Server-driven feedback. Outranks a local unsupported-tap acknowledgement. */
  readonly notice?: RewardsNotice | null;
  /** `'check-in'` or an offer id while that request is in flight. */
  readonly pendingActionId?: string | null;
  readonly onRetry?: () => void;
  readonly onCheckIn?: () => void;
  readonly onRedeem?: (redemption: RewardRedemption) => void;
  readonly onDismissNotice?: () => void;
  readonly onRetryLedger?: () => void;
  readonly onLoadMoreLedger?: () => void;
  readonly onSignIn?: () => void;
  /** When provided, renders a back control. Omitted = tab root. */
  readonly onClose?: () => void;
  readonly onUnavailableAction?: (action: RewardsUnavailableAction) => void;
};

export function RewardsCenterScreen({
  state,
  ledger,
  notice = null,
  pendingActionId = null,
  onRetry,
  onCheckIn,
  onRedeem,
  onDismissNotice,
  onRetryLedger,
  onLoadMoreLedger,
  onSignIn,
  onClose,
  onUnavailableAction,
}: RewardsCenterScreenProps) {
  const { t } = useTranslation();
  const [unavailableAction, setUnavailableAction] = useState<RewardsUnavailableAction | null>(null);

  // A real, server-sourced notice always wins: if the backend just said
  // something happened, that outranks "you tapped a button that does
  // nothing".
  const activeNotice: RewardsNotice | null =
    notice ??
    (unavailableAction
      ? { tone: 'info', message: describeUnavailableAction(t, unavailableAction) }
      : null);
  const activeNoticeMessage = activeNotice?.message ?? null;

  useEffect(() => {
    if (Platform.OS !== 'ios' || !activeNoticeMessage) {
      return;
    }

    AccessibilityInfo.announceForAccessibility(activeNoticeMessage);
  }, [activeNoticeMessage]);

  const handleUnavailableAction = useCallback(
    (action: RewardsUnavailableAction) => {
      // The entire effect of pressing a control the SERVER marked
      // unsupported: record the tap so it is acknowledged rather than
      // silently ignored. No balance, no claim, no entitlement, no network.
      setUnavailableAction(action);
      onUnavailableAction?.(action);
    },
    [onUnavailableAction]
  );

  const handleDismissNotice = useCallback(() => {
    setUnavailableAction(null);
    onDismissNotice?.();
  }, [onDismissNotice]);

  const handleCheckIn = useCallback(
    (checkIn: DailyCheckIn) => {
      // `isClaimSupported` is the server's answer to "can this be claimed at
      // all?", and a false one never reaches the network.
      if (!checkIn.isClaimSupported) {
        handleUnavailableAction({
          kind: 'DAILY_CHECK_IN',
          id: 'daily_check_in',
          label: checkIn.ctaLabel,
        });

        return;
      }

      // An ALREADY-CLAIMED day deliberately still goes through. The backend
      // answers 200 with `awardedPoints: 0` and the wallet unchanged, so the
      // user is told the truth by the authority that knows it - rather than
      // by this screen guessing from a snapshot that may be minutes old.
      onCheckIn?.();
    },
    [handleUnavailableAction, onCheckIn]
  );

  const handleRedeem = useCallback(
    (redemption: RewardRedemption) => {
      // Availability is the SERVER's answer, read here and never recomputed
      // from the balance in the hero. An offer the server has not enabled
      // never reaches the network.
      if (!redemption.isRedeemSupported) {
        handleUnavailableAction({
          kind: 'REDEMPTION',
          id: redemption.id,
          label: redemption.title,
        });

        return;
      }

      onRedeem?.(redemption);
    },
    [handleUnavailableAction, onRedeem]
  );

  const isReady = state.status === 'ready';
  const isServerAuthoritative = isReady && state.snapshot.wallet.isServerAuthoritative;

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
        {isReady && !isServerAuthoritative ? <PreviewBadge /> : null}
      </View>

      {state.status === 'loading' ? (
        <View style={styles.centered} testID="rewards-loading">
          <ActivityIndicator color={Palette.primary} size="large" />
          <Text style={styles.centeredText}>{t('rewards.loading')}</Text>
        </View>
      ) : state.status === 'signInRequired' ? (
        // Rewards is account state by definition: there is no wallet without
        // an owner and no anonymous streak to attach one to. A guest is
        // offered the way in, never a zeroed or preview balance.
        <View style={styles.centered} testID="rewards-sign-in-required">
          <Text accessibilityRole="header" style={styles.stateTitle}>
            {t('rewards.signInTitle')}
          </Text>
          <Text style={styles.stateBody}>{t('rewards.signInBody')}</Text>
          {onSignIn ? (
            <Pressable
              accessibilityRole="button"
              onPress={onSignIn}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              testID="rewards-sign-in-button">
              <Text style={styles.retryButtonText}>{t('rewards.signInCta')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : state.status === 'unavailable' ? (
        // The deployment has the feature switched off. A bounded dead end
        // with no retry - retrying cannot turn a server flag on - and, above
        // all, no fallback to preview numbers.
        <View style={styles.centered} testID="rewards-unavailable">
          <Text accessibilityRole="header" style={styles.stateTitle}>
            {t('rewards.unavailableTitle')}
          </Text>
          <Text style={styles.stateBody}>{state.message}</Text>
        </View>
      ) : state.status === 'error' ? (
        <View style={styles.centered} testID="rewards-error">
          <Text style={styles.errorText}>{state.message}</Text>
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
          {/* Rendered only while the balance is NOT server-authoritative. */}
          {isServerAuthoritative ? null : <PreviewBanner />}

          <PointsBalanceCard
            streakDays={state.snapshot.dailyCheckIn?.currentStreakDays ?? null}
            wallet={state.snapshot.wallet}
          />

          {activeNotice ? (
            <NoticeBanner notice={activeNotice} onDismiss={handleDismissNotice} />
          ) : null}

          <RewardsSection title={t('rewards.sectionDaily')} testID="rewards-section-daily">
            {state.snapshot.dailyCheckIn ? (
              <DailyCheckInCard
                checkIn={state.snapshot.dailyCheckIn}
                isPending={pendingActionId === 'check-in'}
                onPressCta={() => handleCheckIn(state.snapshot.dailyCheckIn!)}
              />
            ) : (
              <RewardEmptyState
                message={t('rewards.checkInEmpty')}
                testID="rewards-check-in-empty"
              />
            )}
          </RewardsSection>

          <RewardsSection title={t('rewards.sectionEarn')} testID="rewards-section-earn">
            <EarnPanel onAction={handleUnavailableAction} tasks={state.snapshot.tasks} />
          </RewardsSection>

          <RewardsSection title={t('rewards.sectionWatch')} testID="rewards-section-watch">
            {state.snapshot.watchTime ? (
              <WatchTimeCard
                onPressCta={() =>
                  handleUnavailableAction({
                    kind: 'WATCH_TIME',
                    id: 'watch_time',
                    label: t('rewards.watchTimeCta'),
                  })
                }
                watchTime={state.snapshot.watchTime}
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
              onRedeem={handleRedeem}
              pendingRedemptionId={pendingActionId}
              redemptions={state.snapshot.redemptions}
            />
          </RewardsSection>

          <RewardsSection title={t('rewards.sectionHistory')} testID="rewards-section-history">
            <TransactionHistoryPanel
              onLoadMore={() => onLoadMoreLedger?.()}
              onRetry={() => onRetryLedger?.()}
              state={ledger}
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
    // the blocks readable as blocks.
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
  stateTitle: {
    fontSize: 17,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 13.5,
    lineHeight: scaledLineHeight(13.5),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
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
  actionBannerSuccess: {
    // A confirmed credit is not a caution. Success gets its own tint so
    // "+10 points" does not read with the same visual weight as "not
    // available".
    borderColor: 'rgba(76, 201, 132, 0.4)',
    backgroundColor: 'rgba(76, 201, 132, 0.10)',
  },
  actionBannerText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: scaledLineHeight(12.5),
    fontFamily: FontFamily.semiBold,
    color: Palette.primaryHover,
  },
  actionBannerTextSuccess: {
    color: '#8FE3B4',
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
