import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { DailyCheckInCard } from '@/features/rewards/components/daily-check-in-card';
import { EarnPanel } from '@/features/rewards/components/earn-panel';
import { PointsBalanceCard } from '@/features/rewards/components/points-balance-card';
import { RedeemPanel } from '@/features/rewards/components/redeem-panel';
import { RewardsHistorySheet } from '@/features/rewards/components/rewards-history-sheet';
import {
  InfoPill,
  PreviewBadge,
  PreviewBanner,
  RewardEmptyState,
  RewardsSection,
} from '@/features/rewards/components/rewards-primitives';
import { WatchTimeCard } from '@/features/rewards/components/watch-time-card';
import { useFormatPoints } from '@/features/rewards/format-points';
import { selectRedeemHint } from '@/features/rewards/redeem-hint';
import { RewardAmbient, RewardSurface, scaledLineHeight } from '@/features/rewards/rewards-theme';
import { useTranslation, type Translate } from '@/stores/language';
import type {
  DailyCheckIn,
  RewardRedemption,
  RewardsLedgerState,
  RewardsNotice,
  RewardsSnapshot,
  RewardsUnavailableAction,
  RewardsViewState,
} from '@/types/rewards';

/**
 * Rewards Center.
 *
 * ONE SCREEN, ONE VERTICAL SCROLL. The reference design for this surface is
 * three screenshots, and they are three SCROLL POSITIONS of the same page -
 * not three screens, not three tabs, not a carousel. The blocks below are in
 * the order a first-time user asks the questions:
 *   1. balance hero      -> "how many coins do I have?"
 *   2. Check-in          -> "what can I do today?"
 *   3. Earn Coins        -> "how do I get more?"
 *   4. Watch-time bonus  -> "...and by watching?"
 *   5. Redeem            -> "what is this worth?"
 * The sixth question - "where did my coins go?" - is one tap away in the
 * header, because history is the only block that can run to dozens of rows
 * and it would otherwise push the redemption catalog off the end of a long
 * scroll.
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
 *   - the only figures it DERIVES are counts and selections over data the
 *     server sent (how many tasks it called COMPLETED, which offer it called
 *     AVAILABLE) - never a coin value, a cost or an eligibility
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
        style={[
          styles.actionBannerText,
          notice.tone === 'success' && styles.actionBannerTextSuccess,
        ]}>
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

/**
 * The streak chip beside the check-in heading.
 *
 * The flame is decorative and hidden from screen readers - the pill carries
 * one accessible sentence, so a reader hears "current streak 4 days" rather
 * than an emoji name followed by a fragment.
 */
function StreakPill({ days }: { readonly days: number }) {
  const { t } = useTranslation();

  return (
    <InfoPill accessibilityLabel={t('rewards.streakChipA11y', { days })} testID="rewards-streak-chip">
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.streakFlame}>
        🔥
      </Text>
      <Text style={styles.streakText}>{t('rewards.streakChip', { days })}</Text>
    </InfoPill>
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
  const insets = useSafeAreaInsets();
  const [unavailableAction, setUnavailableAction] = useState<RewardsUnavailableAction | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  /**
   * Where the redemption block starts inside the scroll content, measured on
   * layout rather than estimated. The hero's "Tukar koin" jumps here, and
   * the offsets above it change with the OS text size, the number of tasks
   * and whether a notice is showing - so a constant would be wrong on most
   * devices.
   */
  const redeemOffsetRef = useRef(0);

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

  const handleRedeemSectionLayout = useCallback((event: LayoutChangeEvent) => {
    redeemOffsetRef.current = event.nativeEvent.layout.y;
  }, []);

  const scrollToRedeem = useCallback(() => {
    scrollRef.current?.scrollTo({
      // A few points of headroom so the section heading is not flush against
      // the top edge of the viewport after the jump.
      y: Math.max(0, redeemOffsetRef.current - 12),
      animated: true,
    });
  }, []);

  const openHistory = useCallback(() => setIsHistoryOpen(true), []);
  const closeHistory = useCallback(() => setIsHistoryOpen(false), []);

  const isReady = state.status === 'ready';
  const isServerAuthoritative = isReady && state.snapshot.wallet.isServerAuthoritative;

  return (
    <View style={styles.container} testID="rewards-screen">
      {/* The warm wash sits behind the header and hero and fades out before
          the first section, so the rest of the scroll keeps the app's plain
          near-black page colour. Non-interactive by construction. */}
      <LinearGradient
        colors={RewardAmbient.gradient}
        end={{ x: 0.4, y: 1 }}
        pointerEvents="none"
        start={{ x: 0, y: 0 }}
        style={styles.ambient}
      />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
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
        {/* Offered only in the ready state: in every other state there is no
            settled ledger to open, and a control that opens an empty sheet
            reads as a broken one. */}
        {isReady ? (
          <Pressable
            accessibilityLabel={t('rewards.historyOpenA11y')}
            accessibilityRole="button"
            onPress={openHistory}
            style={({ pressed }) => [styles.historyButton, pressed && styles.pressed]}
            testID="rewards-history-button">
            <Text style={styles.historyButtonText}>{t('rewards.historyCta')}</Text>
          </Pressable>
        ) : null}
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
        <RewardsScroll
          activeNotice={activeNotice}
          isHistoryOpen={isHistoryOpen}
          onCheckIn={handleCheckIn}
          onDismissNotice={handleDismissNotice}
          onRedeem={handleRedeem}
          onRedeemSectionLayout={handleRedeemSectionLayout}
          onScrollToRedeem={scrollToRedeem}
          onUnavailableAction={handleUnavailableAction}
          pendingActionId={pendingActionId}
          scrollRef={scrollRef}
          snapshot={state.snapshot}
        />
      )}

      <RewardsHistorySheet
        ledger={ledger}
        onClose={closeHistory}
        onLoadMore={() => onLoadMoreLedger?.()}
        onRetry={() => onRetryLedger?.()}
        visible={isHistoryOpen}
      />
    </View>
  );
}

type RewardsScrollProps = {
  readonly snapshot: RewardsSnapshot;
  readonly activeNotice: RewardsNotice | null;
  readonly pendingActionId: string | null;
  readonly scrollRef: RefObject<ScrollView | null>;
  readonly isHistoryOpen: boolean;
  readonly onCheckIn: (checkIn: DailyCheckIn) => void;
  readonly onRedeem: (redemption: RewardRedemption) => void;
  readonly onUnavailableAction: (action: RewardsUnavailableAction) => void;
  readonly onDismissNotice: () => void;
  readonly onRedeemSectionLayout: (event: LayoutChangeEvent) => void;
  readonly onScrollToRedeem: () => void;
};

/**
 * The ready state's single scroll.
 *
 * Split out of `RewardsCenterScreen` so the screen file stays readable and
 * the derivations below (`completedTasks`, `redeemHint`) sit next to the
 * markup that consumes them. It holds no state of its own.
 */
function RewardsScroll({
  snapshot,
  activeNotice,
  pendingActionId,
  scrollRef,
  isHistoryOpen,
  onCheckIn,
  onRedeem,
  onUnavailableAction,
  onDismissNotice,
  onRedeemSectionLayout,
  onScrollToRedeem,
}: RewardsScrollProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();

  // Counted from the status the SERVER put on each task. This is not the
  // client deciding a task is done - `COMPLETED` is the backend's word, and
  // today it sends none, so the counter honestly reads "0 of 5".
  const completedTasks = snapshot.tasks.filter((task) => task.status === 'COMPLETED').length;
  const streakDays = snapshot.dailyCheckIn?.currentStreakDays ?? 0;
  const redeemHint = selectRedeemHint(snapshot.redemptions);
  const valueHint =
    redeemHint === null
      ? null
      : redeemHint.kind === 'AFFORDABLE'
        ? t('rewards.hintAffordable', { title: redeemHint.title })
        : t('rewards.hintCheapest', { points: formatPoints(redeemHint.costPoints) });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      ref={scrollRef}
      // While the history sheet is up the page behind it must not scroll
      // under the user's finger on Android, where touches can still reach it.
      scrollEnabled={!isHistoryOpen}
      showsVerticalScrollIndicator={false}
      testID="rewards-scroll">
      {/* Rendered only while the balance is NOT server-authoritative. */}
      {snapshot.wallet.isServerAuthoritative ? null : <PreviewBanner />}

      <PointsBalanceCard
        onPressRedeem={snapshot.redemptions.length > 0 ? onScrollToRedeem : undefined}
        valueHint={valueHint}
        wallet={snapshot.wallet}
      />

      {activeNotice ? <NoticeBanner notice={activeNotice} onDismiss={onDismissNotice} /> : null}

      <RewardsSection
        testID="rewards-section-daily"
        title={t('rewards.sectionDaily')}
        trailing={streakDays > 0 ? <StreakPill days={streakDays} /> : null}>
        {snapshot.dailyCheckIn ? (
          <DailyCheckInCard
            checkIn={snapshot.dailyCheckIn}
            isPending={pendingActionId === 'check-in'}
            onPressCta={() => onCheckIn(snapshot.dailyCheckIn!)}
          />
        ) : (
          <RewardEmptyState message={t('rewards.checkInEmpty')} testID="rewards-check-in-empty" />
        )}
      </RewardsSection>

      <RewardsSection
        testID="rewards-section-earn"
        title={t('rewards.sectionEarn')}
        trailing={
          snapshot.tasks.length > 0 ? (
            <Text style={styles.sectionStatus} testID="rewards-earn-progress">
              {t('rewards.earnProgress', {
                done: completedTasks,
                total: snapshot.tasks.length,
              })}
            </Text>
          ) : null
        }>
        <EarnPanel onAction={onUnavailableAction} tasks={snapshot.tasks} />
      </RewardsSection>

      <RewardsSection testID="rewards-section-watch" title={t('rewards.sectionWatch')}>
        {snapshot.watchTime ? (
          <WatchTimeCard
            onPressCta={() =>
              onUnavailableAction({
                kind: 'WATCH_TIME',
                id: 'watch_time',
                label: t('rewards.watchTimeCta'),
              })
            }
            watchTime={snapshot.watchTime}
          />
        ) : (
          // The backend sends `watchTime: null` and means it: its only watch
          // signal is a per-series resume position that DECREASES on a
          // rewatch. The section keeps its place in the page and states that
          // it is not open yet - it does not draw an empty progress bar, and
          // it names no minute target and no coin amount, because there is no
          // authoritative one to name.
          <RewardEmptyState
            message={t('rewards.watchTimeEmpty')}
            statusLabel={t('rewards.ctaSoon')}
            testID="rewards-watch-time-empty"
          />
        )}
      </RewardsSection>

      <RewardsSection
        onLayout={onRedeemSectionLayout}
        testID="rewards-section-redeem"
        title={t('rewards.sectionRedeem')}>
        <RedeemPanel
          onRedeem={onRedeem}
          pendingRedemptionId={pendingActionId}
          redemptions={snapshot.redemptions}
        />
      </RewardsSection>

      <View style={styles.footnote} testID="rewards-footnote">
        <Text style={styles.footnoteText}>{t('rewards.footnote')}</Text>
        {/* A real server fact that had no home before: the reward day is
            defined by the SERVICE timezone, not the device clock, so a phone
            whose clock is moved forward gets the same answer. */}
        {snapshot.dailyCheckIn ? (
          <Text style={styles.footnoteText}>{snapshot.dailyCheckIn.resetsAtLabel}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  ambient: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: 320,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
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
    borderColor: RewardSurface.cardBorder,
    backgroundColor: RewardSurface.card,
  },
  backButtonText: {
    fontSize: 26,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 25,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  historyButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  historyButtonText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  content: {
    paddingHorizontal: 16,
    // The tabs navigator lays its bar out IN FLOW, so a tab screen's box
    // already ends at the top edge of the bar (see `use-feed-bottom-anchor`
    // for why adding the bar height here would double-count it). This is
    // breathing room under the last card, not a clearance hack.
    paddingBottom: 32,
    // Sections breathe more than the cards inside them, which is what makes
    // the blocks readable as blocks.
    gap: 20,
  },
  sectionStatus: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  streakFlame: {
    fontSize: 12,
  },
  streakText: {
    fontSize: 11.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  footnote: {
    gap: 3,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  footnoteText: {
    fontSize: 11,
    lineHeight: scaledLineHeight(11),
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
    textAlign: 'center',
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
    // "+10 coins" does not read with the same visual weight as "not
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
