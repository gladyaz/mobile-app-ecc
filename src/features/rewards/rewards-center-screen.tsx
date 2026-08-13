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
import { EarnPanel } from '@/features/rewards/components/earn-panel';
import { PointsBalanceCard } from '@/features/rewards/components/points-balance-card';
import { RedeemPanel } from '@/features/rewards/components/redeem-panel';
import { PreviewBadge } from '@/features/rewards/components/rewards-primitives';
import { FIXTURE_REWARDS_SNAPSHOT } from '@/features/rewards/rewards-fixtures';
import { scaledLineHeight } from '@/features/rewards/rewards-theme';
import type { RewardsPrototypeAction, RewardsViewState } from '@/types/rewards';

/**
 * Rewards Center - foundation slice.
 *
 * Standalone on purpose. It lives under `src/features/` rather than
 * `src/app/` because Expo Router is file-based: a file in `src/app/` would
 * register a live route in the root `<Stack>`, and root/bottom navigation
 * is out of scope for this slice. Wiring it up is one file
 * (`src/app/rewards.tsx` re-exporting this component) plus a `Stack.Screen`
 * entry, done in the integration slice.
 *
 * WHAT THIS SCREEN DOES NOT DO - and must not start doing without the
 * backend contract in `docs/rewards-domain-contract.md` being implemented
 * first:
 *   - it never mutates a points balance, locally or remotely
 *   - it never claims a task or marks a check-in
 *   - it never touches the entitlement system
 *   - it never starts an ad, opens a social link, or runs a watch timer
 *
 * The single piece of state it owns beyond the active tab is
 * `pendingAction`: which CTA the user last tapped, so the screen can say
 * why nothing happened.
 */

const TABS = [
  { key: 'earn', label: 'Kumpulkan' },
  { key: 'redeem', label: 'Tukar Poin' },
] as const;

type RewardsTabKey = (typeof TABS)[number]['key'];

const FOOTER_DISCLAIMER =
  'Semua angka di layar ini masih fixture pratinjau dan belum disetujui sebagai nilai reward final.';

function describePendingAction(action: RewardsPrototypeAction): string {
  return `"${action.label}" belum tersedia. Aksi ini tidak menambah poin, tidak menyelesaikan misi, dan tidak mengaktifkan VIP.`;
}

type ActionBannerProps = {
  readonly action: RewardsPrototypeAction;
  readonly onDismiss: () => void;
};

function ActionBanner({ action, onDismiss }: ActionBannerProps) {
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
      <Text style={styles.actionBannerText}>{describePendingAction(action)}</Text>
      <Pressable
        accessibilityLabel="Tutup pemberitahuan"
        accessibilityRole="button"
        onPress={onDismiss}
        style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
        testID="rewards-action-banner-dismiss">
        <Text style={styles.dismissButtonText}>Tutup</Text>
      </Pressable>
    </View>
  );
}

export type RewardsCenterScreenProps = {
  /**
   * Defaults to the placeholder snapshot so the screen is renderable before
   * any service exists.
   *
   * INTEGRATION NOTE: when `src/app/rewards.tsx` is added, make this prop
   * REQUIRED and delete the default. Otherwise a caller that forgets to
   * thread real state silently ships a plausible-looking balance whose only
   * tell is the preview badge.
   */
  readonly state?: RewardsViewState;
  readonly onRetry?: () => void;
  /** When provided, renders a back control. Omitted = standalone/embedded. */
  readonly onClose?: () => void;
  readonly onPrototypeAction?: (action: RewardsPrototypeAction) => void;
};

export function RewardsCenterScreen({
  state = { status: 'ready', snapshot: FIXTURE_REWARDS_SNAPSHOT },
  onRetry,
  onClose,
  onPrototypeAction,
}: RewardsCenterScreenProps) {
  const [activeTab, setActiveTab] = useState<RewardsTabKey>('earn');
  const [pendingAction, setPendingAction] = useState<RewardsPrototypeAction | null>(null);

  const handlePrototypeAction = useCallback(
    (action: RewardsPrototypeAction) => {
      // The entire effect of every CTA in this slice. No balance, no claim,
      // no entitlement - just a record of what was tapped, an announcement
      // for screen-reader users, plus an optional notification to the host
      // so integration work has a seam to use.
      setPendingAction(action);

      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(describePendingAction(action));
      }

      onPrototypeAction?.(action);
    },
    [onPrototypeAction]
  );

  return (
    <View style={styles.container} testID="rewards-center-screen">
      <View style={styles.header}>
        {onClose ? (
          <Pressable
            accessibilityLabel="Kembali"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            testID="rewards-back-button">
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
        ) : null}
        <Text style={styles.title}>Rewards</Text>
        <PreviewBadge />
      </View>

      {state.status === 'loading' ? (
        <View style={styles.centered} testID="rewards-loading">
          <ActivityIndicator color={Palette.primary} size="large" />
          <Text style={styles.centeredText}>Memuat rewards...</Text>
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
              <Text style={styles.retryButtonText}>Coba Lagi</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <PointsBalanceCard wallet={state.snapshot.wallet} />

          {pendingAction ? (
            <ActionBanner action={pendingAction} onDismiss={() => setPendingAction(null)} />
          ) : null}

          <View accessibilityRole="tablist" style={styles.tabBar}>
            {TABS.map((tab) => {
              const isActive = tab.key === activeTab;

              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  style={({ pressed }) => [
                    styles.tab,
                    isActive && styles.tabActive,
                    pressed && styles.pressed,
                  ]}
                  testID={`rewards-tab-${tab.key}`}>
                  <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {activeTab === 'earn' ? (
            <EarnPanel
              dailyCheckIn={state.snapshot.dailyCheckIn}
              onAction={handlePrototypeAction}
              tasks={state.snapshot.tasks}
              watchTime={state.snapshot.watchTime}
            />
          ) : (
            <RedeemPanel
              onAction={handlePrototypeAction}
              redemptions={state.snapshot.redemptions}
            />
          )}

          <Text style={styles.footerDisclaimer}>{FOOTER_DISCLAIMER}</Text>
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
    paddingTop: 60,
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
    paddingBottom: 40,
    gap: 16,
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
    fontSize: 12,
    lineHeight: scaledLineHeight(12),
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
  tabBar: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  tabActive: {
    backgroundColor: Palette.surface,
  },
  tabText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  tabTextActive: {
    color: Palette.text,
  },
  footerDisclaimer: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: scaledLineHeight(11),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
