import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardAccent, RewardUnavailable, scaledLineHeight } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';

/**
 * Shared presentational primitives for the Rewards Center.
 *
 * Several small components share this module rather than getting a file
 * each. That is a deliberate exception to "one component per file": they are
 * the feature's private vocabulary, none is meaningful alone, and every one
 * is well under 40 lines.
 *
 * Nothing here knows a point value, a cost, or a threshold - every number
 * arrives as a prop.
 *
 * PREVIEW HONESTY LIVES IN TWO PLACES ONLY, by design:
 *   1. `PreviewBanner` - one page-level statement, near the top.
 *   2. `RewardCta`'s accessibility hint + unavailable styling, per control.
 * There is deliberately no per-card notice component any more. The previous
 * layout repeated a paragraph of backend/ledger/SDK detail beside six
 * separate cards, which read as a debug screen and trained users to skip
 * every box on the page. That detail now lives in code comments, tests and
 * `docs/rewards-domain-contract.md` - not in the consumer UI.
 */

/** Announced on every CTA that has no server-verified action behind it. */
export const UNAVAILABLE_CTA_HINT_KEY = 'rewards.unavailableCtaHint' as const;

/**
 * The single page-level "this is not live" statement.
 *
 * Grouped into one accessible node so a screen reader announces one
 * sentence rather than two fragments.
 */
export function PreviewBanner() {
  const { t } = useTranslation();
  const title = t('rewards.previewBannerTitle');
  const body = t('rewards.previewBannerBody');

  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${body}`}
      style={styles.previewBanner}
      testID="rewards-preview-banner">
      <Text style={styles.previewBannerTitle}>{title}</Text>
      <Text style={styles.previewBannerBody}>{body}</Text>
    </View>
  );
}

type RewardsSectionProps = {
  readonly title: string;
  readonly children: ReactNode;
  readonly testID?: string;
};

/**
 * A titled block. The four section headings are what let a first-time user
 * answer "what can I do here?" by scanning rather than reading.
 */
export function RewardsSection({ title, children, testID }: RewardsSectionProps) {
  return (
    <View style={styles.section} testID={testID}>
      <Text accessibilityRole="header" style={styles.sectionHeading}>
        {title}
      </Text>
      {children}
    </View>
  );
}

type RewardsCardProps = {
  readonly children: ReactNode;
  readonly testID?: string;
};

/**
 * A plain surface. It carries no title of its own - the enclosing
 * `RewardsSection` heading names it, so a card and a heading no longer
 * repeat the same words at two type sizes.
 */
export function RewardsCard({ children, testID }: RewardsCardProps) {
  return (
    <View style={styles.card} testID={testID}>
      {children}
    </View>
  );
}

type PointsPillProps = {
  readonly points: number;
  readonly testID?: string;
};

/** "+50" reward chip. The `+` is presentational; it never implies a credit. */
export function PointsPill({ points, testID }: PointsPillProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();

  return (
    // Grouped with a unit-bearing label: the visible chip is just "+50", and
    // a screen reader announcing a bare "plus 50" out of context is ambiguous.
    <View
      accessible
      accessibilityLabel={t('rewards.pointsPillA11y', { points: formatPoints(points) })}
      style={styles.pointsPill}>
      <Text style={styles.pointsPillText} testID={testID}>
        {t('rewards.pointsPill', { points: formatPoints(points) })}
      </Text>
    </View>
  );
}

/** Header chip. The preview status is visible before a single card is read. */
export function PreviewBadge() {
  const { t } = useTranslation();

  return (
    <View style={styles.previewBadge}>
      <Text style={styles.previewBadgeText}>{t('rewards.previewBadge')}</Text>
    </View>
  );
}

type RewardEmptyStateProps = {
  readonly message: string;
  readonly testID: string;
};

/**
 * Rendered in place of a section that has no data, rather than dropping the
 * section entirely - a silently missing section is indistinguishable from a
 * bug, and the user cannot tell that a check-in or a reward list is even
 * meant to be there.
 */
export function RewardEmptyState({ message, testID }: RewardEmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      <Text style={styles.emptyStateText}>{message}</Text>
    </View>
  );
}

type RewardProgressBarProps = {
  readonly current: number;
  readonly target: number;
  /**
   * What the bar is measuring - the subject only. The numbers are carried
   * solely by `accessibilityValue` below, so a caller cannot compose a label
   * that contradicts the announced value.
   */
  readonly label: string;
  readonly testID?: string;
};

export function RewardProgressBar({ current, target, label, testID }: RewardProgressBarProps) {
  // Guards a divide-by-zero and any out-of-range payload once these numbers
  // come from the network rather than a fixture.
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 0;
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : 0;
  const clampedCurrent = Math.min(safeCurrent, safeTarget);
  const ratio = safeTarget === 0 ? 0 : clampedCurrent / safeTarget;

  return (
    // `accessible` is required: a plain View with accessibility props but no
    // `accessible` flag is not an accessibility element on iOS, so the role,
    // label and value would all be silently dropped for VoiceOver.
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: safeTarget, now: clampedCurrent }}
      style={styles.progressTrack}
      testID={testID}>
      <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
    </View>
  );
}

type RewardCtaProps = {
  readonly label: string;
  /**
   * Whether a server-verified action exists. Supplied by the model, never
   * decided here. False renders the unavailable treatment and attaches the
   * hint; the press handler still fires so the caller can acknowledge the
   * tap, but no caller in this feature mutates any balance.
   */
  readonly isSupported: boolean;
  readonly onPress: () => void;
  readonly testID: string;
  /** Narrower variant for scannable rows. Height stays at the 44pt floor. */
  readonly compact?: boolean;
  /**
   * Announced name, when the visible label is not unique on its own.
   * Adjacent rows legitimately share CTA words - two "Follow" buttons, two
   * "Redeem" buttons - which leaves a rotor listing or a Voice Control
   * command ambiguous. Callers pass the row's subject in here.
   */
  readonly accessibilityLabel?: string;
  /**
   * A request this control started is in flight.
   *
   * It renders a spinner INSTEAD OF a changed number, which is the whole
   * point: the balance must not move until the server has answered, so the
   * only honest thing to show meanwhile is that we are waiting. It also
   * blocks the press, so a double-tap cannot open a second request.
   */
  readonly isPending?: boolean;
};

export function RewardCta({
  label,
  isSupported,
  onPress,
  testID,
  compact = false,
  accessibilityLabel,
  isPending = false,
}: RewardCtaProps) {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityHint={isSupported ? undefined : t(UNAVAILABLE_CTA_HINT_KEY)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: isPending, busy: isPending }}
      disabled={isPending}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cta,
        compact ? styles.ctaCompact : styles.ctaFull,
        isSupported ? styles.ctaSupported : styles.ctaUnavailable,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      {isPending ? (
        <ActivityIndicator
          color={isSupported ? Palette.background : RewardUnavailable.text}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.ctaText,
            isSupported ? styles.ctaTextSupported : styles.ctaTextUnavailable,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  previewBanner: {
    gap: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    // Caution-orange, NOT the reward gold. Gold means "this figure is worth
    // something" everywhere else on the page (balance, points pills, costs);
    // dressing the disclaimer in it both weakened that signal and gave the
    // banner the same visual weight as the balance card beneath it. This
    // matches PreviewBadge / the balance preview tag / ActionBanner.
    borderColor: 'rgba(255, 122, 26, 0.4)',
    backgroundColor: 'rgba(255, 122, 26, 0.09)',
  },
  previewBannerTitle: {
    fontSize: 13,
    fontFamily: FontFamily.extraBold,
    // 9.2:1 on the page background.
    color: Palette.primaryHover,
  },
  previewBannerBody: {
    fontSize: 12.5,
    lineHeight: scaledLineHeight(12.5),
    fontFamily: FontFamily.regular,
    color: Palette.text,
  },
  section: {
    gap: 10,
  },
  sectionHeading: {
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: FontFamily.extraBold,
    color: Palette.textSecondary,
  },
  card: {
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  pointsPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  pointsPillText: {
    fontSize: 12.5,
    fontFamily: FontFamily.extraBold,
    color: RewardAccent.gold,
  },
  previewBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 26, 0.4)',
    // Given a fill: this badge is the only honesty cue that never scrolls
    // away, so it should not also be the faintest mark on the page.
    backgroundColor: 'rgba(255, 122, 26, 0.09)',
  },
  previewBadgeText: {
    fontSize: 11.5,
    letterSpacing: 1,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  emptyStateText: {
    fontSize: 12.5,
    lineHeight: scaledLineHeight(12.5),
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  progressTrack: {
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: RewardAccent.track,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: RewardAccent.gold,
  },
  cta: {
    // 44pt is the accessibility floor and is never traded away for density.
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  ctaFull: {
    minWidth: 96,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ctaCompact: {
    minWidth: 88,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ctaSupported: {
    borderColor: RewardAccent.gold,
    backgroundColor: RewardAccent.gold,
  },
  ctaUnavailable: {
    borderColor: RewardUnavailable.border,
    backgroundColor: RewardUnavailable.background,
  },
  ctaText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    textAlign: 'center',
  },
  ctaTextSupported: {
    // Dark ink on the gold fill: 10.5:1, versus 1.9:1 for white.
    color: Palette.background,
  },
  ctaTextUnavailable: {
    color: RewardUnavailable.text,
  },
  pressed: {
    opacity: 0.75,
  },
});
