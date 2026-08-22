import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { FontFamily, Gradients, Palette, Radius } from '@/constants/theme';
import { useFormatPoints } from '@/features/rewards/format-points';
import {
  RewardAccent,
  RewardSurface,
  RewardUnavailable,
  scaledLineHeight,
} from '@/features/rewards/rewards-theme';
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
  /**
   * Rendered on the heading's right edge - the streak pill, the "2/5 done"
   * counter. It is a SLOT rather than a string so a caller can supply a
   * styled pill without this module knowing what a streak is.
   */
  readonly trailing?: ReactNode;
  /**
   * Reported so the screen can learn where this block starts inside the
   * scroll, which is how the hero's "redeem" button knows where to jump.
   * Measured rather than estimated: the offsets above a section change with
   * the OS text size and with how many tasks the server sent.
   */
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly testID?: string;
};

/**
 * A titled block, with an optional status on the same line.
 *
 * The heading is sentence-case white rather than the previous uppercase
 * grey: at 13px with 0.8 letter-spacing it read as a form label above a
 * form, which flattened the page into one long list. A heading that looks
 * like a heading is what lets a first-time user find "Tukar koin" by
 * scanning instead of reading.
 */
export function RewardsSection({
  title,
  children,
  trailing,
  onLayout,
  testID,
}: RewardsSectionProps) {
  return (
    <View onLayout={onLayout} style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionHeading}>
          {title}
        </Text>
        {trailing ?? null}
      </View>
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

type CoinMarkProps = {
  /** Diameter in points. Defaults to the inline-with-text size. */
  readonly size?: number;
  /** Muted rendering for an upcoming/locked position. */
  readonly isMuted?: boolean;
};

/**
 * The coin glyph that marks a value as spendable currency.
 *
 * Two concentric rings drawn with border radius - no image asset, no icon
 * font, nothing to download. It is DECORATIVE everywhere it is used: each
 * site pairs it with the number and the unit word, so a reader that skips
 * it loses nothing.
 */
export function CoinMark({ size = 14, isMuted = false }: CoinMarkProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.coin,
        isMuted && styles.coinMuted,
        { width: size, height: size, borderRadius: size / 2 },
      ]}>
      <View
        style={[
          styles.coinCore,
          isMuted && styles.coinCoreMuted,
          { width: size * 0.44, height: size * 0.44, borderRadius: size * 0.22 },
        ]}
      />
    </View>
  );
}

type InfoPillProps = {
  readonly children: ReactNode;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
};

/**
 * A read-only status chip: the streak, the earn counter, the hero's value
 * hint. Deliberately NOT pressable and deliberately not the CTA shape, so
 * nothing on this page looks tappable unless it is.
 */
export function InfoPill({ children, accessibilityLabel, testID }: InfoPillProps) {
  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      style={styles.infoPill}
      testID={testID}>
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
  /**
   * Optional short status word rendered as a muted chip - "Segera" beside a
   * block this deployment cannot fill yet. The enclosing section heading
   * already names the block, so there is deliberately no title slot here.
   */
  readonly statusLabel?: string;
};

/**
 * Rendered in place of a section that has no data, rather than dropping the
 * section entirely - a silently missing section is indistinguishable from a
 * bug, and the user cannot tell that a check-in or a reward list is even
 * meant to be there.
 *
 * It is a CARD, not a dashed placeholder box: the sections it stands in for
 * are real parts of the product that this deployment cannot fill yet, and a
 * dashed outline reads as a rendering failure rather than as "not yet".
 */
export function RewardEmptyState({ message, testID, statusLabel }: RewardEmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      <View style={styles.emptyStateBody}>
        <Text style={styles.emptyStateText}>{message}</Text>
      </View>
      {statusLabel ? (
        <View style={styles.emptyStateChip}>
          <Text style={styles.emptyStateChipText}>{statusLabel}</Text>
        </View>
      ) : null}
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

/**
 * How much visual weight a SUPPORTED control carries.
 *
 * `primary` is the warm gradient the rest of the app already uses for its
 * one main action per screen (auth, profile) - here that is "check in" and
 * "redeem", the two controls that actually reach the backend. `neutral` is
 * the light pill used by row-level actions, so five task rows do not each
 * shout as loudly as the page's main CTA.
 *
 * The tone is IGNORED when `isSupported` is false: an unavailable control
 * always renders in the muted treatment, so no caller can dress a dead
 * button as a live one.
 */
export type RewardCtaTone = 'primary' | 'neutral';

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
  /** Fills the width of its parent - the check-in and hero actions. */
  readonly fullWidth?: boolean;
  readonly tone?: RewardCtaTone;
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
  fullWidth = false,
  tone = 'neutral',
  accessibilityLabel,
  isPending = false,
}: RewardCtaProps) {
  const { t } = useTranslation();
  const isPrimary = isSupported && tone === 'primary';
  const content = isPending ? (
    <ActivityIndicator
      color={isPrimary ? Palette.text : isSupported ? Palette.background : RewardUnavailable.text}
      size="small"
    />
  ) : (
    <Text
      // Bounded scaling, but NOT clamped to one line: a clipped CTA word
      // ("Belum Tersedi...") is a worse outcome at large text sizes than a
      // button that grows a second line, and the 44pt floor is a minimum.
      maxFontSizeMultiplier={1.4}
      style={[
        styles.ctaText,
        isPrimary
          ? styles.ctaTextPrimary
          : isSupported
            ? styles.ctaTextNeutral
            : styles.ctaTextUnavailable,
      ]}>
      {label}
    </Text>
  );

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
        fullWidth && styles.ctaFullWidth,
        // The gradient variant paints its own fill, so the shell keeps the
        // solid primary underneath it - a gradient that fails to composite
        // still leaves a coloured, legible button rather than a hole.
        isPrimary ? styles.ctaPrimaryShell : isSupported ? styles.ctaNeutral : styles.ctaUnavailable,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      {isPrimary ? (
        <LinearGradient
          colors={Gradients.primary}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={styles.ctaGradient}
        />
      ) : null}
      {content}
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionHeading: {
    flexShrink: 1,
    fontSize: 15.5,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  card: {
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: RewardSurface.cardBorder,
    borderRadius: Radius.xl,
    backgroundColor: RewardSurface.card,
  },
  coin: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 214, 140, 0.55)',
    backgroundColor: RewardAccent.gold,
  },
  coinMuted: {
    borderColor: Palette.border,
    backgroundColor: Palette.textDisabled,
  },
  coinCore: {
    backgroundColor: 'rgba(120, 74, 8, 0.55)',
  },
  coinCoreMuted: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  infoPill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: RewardSurface.chipBorder,
    backgroundColor: RewardSurface.chip,
  },
  pointsPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  pointsPillText: {
    fontSize: 11.5,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: RewardSurface.cardBorder,
    backgroundColor: RewardSurface.card,
  },
  emptyStateBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  emptyStateText: {
    fontSize: 12,
    lineHeight: scaledLineHeight(12),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  emptyStateChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: RewardUnavailable.border,
    backgroundColor: RewardUnavailable.background,
  },
  emptyStateChipText: {
    fontSize: 11.5,
    fontFamily: FontFamily.bold,
    color: RewardUnavailable.text,
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
    overflow: 'hidden',
  },
  ctaFull: {
    minWidth: 96,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ctaCompact: {
    minWidth: 84,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ctaFullWidth: {
    alignSelf: 'stretch',
  },
  ctaGradient: {
    // Painted behind the label rather than around it, so the button's own
    // padding still decides its size and the 44pt floor is unaffected.
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  ctaPrimaryShell: {
    borderColor: 'transparent',
    backgroundColor: Palette.primary,
  },
  ctaNeutral: {
    borderColor: '#E8E8EC',
    backgroundColor: '#F2F2F5',
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
  ctaTextPrimary: {
    color: Palette.text,
  },
  ctaTextNeutral: {
    // Dark ink on the light pill: 15.6:1.
    color: Palette.background,
  },
  ctaTextUnavailable: {
    color: RewardUnavailable.text,
  },
  pressed: {
    opacity: 0.75,
  },
});
