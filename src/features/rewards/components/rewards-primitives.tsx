import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { formatPoints } from '@/features/rewards/format-points';
import { RewardAccent, RewardUnavailable, scaledLineHeight } from '@/features/rewards/rewards-theme';

/**
 * Shared presentational primitives for the Rewards Center.
 *
 * Six small components share this module rather than getting a file each.
 * That is a deliberate exception to "one component per file": they are the
 * feature's private vocabulary, none is meaningful alone, and every one is
 * under 40 lines. If any of them grows a real API or gains an outside
 * consumer, split it out then.
 *
 * Nothing here knows a point value, a cost, or a threshold - every number
 * arrives as a prop. These components also carry the single, consistent
 * treatment of the "no backend behind this yet" state, so that honesty is
 * implemented once instead of being re-decided per card.
 */

/** Announced on every CTA that has no server-verified action behind it. */
export const UNAVAILABLE_CTA_HINT =
  'Belum tersedia. Menunggu integrasi backend rewards - menekan tombol ini tidak menambah poin.';

type RewardsCardProps = {
  readonly title: string;
  readonly caption?: string;
  readonly children: ReactNode;
  readonly testID?: string;
};

export function RewardsCard({ title, caption, children, testID }: RewardsCardProps) {
  return (
    <View style={styles.card} testID={testID}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {title}
      </Text>
      {caption ? <Text style={styles.cardCaption}>{caption}</Text> : null}
      {children}
    </View>
  );
}

type PointsPillProps = {
  readonly points: number;
  readonly testID?: string;
};

/** "+50 poin" chip. The `+` is presentational; it never implies a credit. */
export function PointsPill({ points, testID }: PointsPillProps) {
  return (
    <View style={styles.pointsPill}>
      <Text style={styles.pointsPillText} testID={testID}>
        +{formatPoints(points)} poin
      </Text>
    </View>
  );
}

/**
 * Marks a surface as not-yet-real. Used on the screen header so the preview
 * status is visible before the user reads a single card.
 */
export function PreviewBadge() {
  return (
    <View style={styles.previewBadge}>
      <Text style={styles.previewBadgeText}>PRATINJAU</Text>
    </View>
  );
}

type RewardNoticeProps = {
  readonly message: string;
  readonly testID?: string;
};

/**
 * Inline caveat line - why a surface cannot do what it appears to do.
 *
 * Styled neutrally rather than in `Palette.warning`. Nothing here is an
 * error or a hazard, and a screen that repeats a saturated yellow block
 * beside every card ends up teaching users to skip all of them - including
 * the ones that matter. The loud signal is the single header badge; these
 * are the quiet, specific reasons.
 */
export function RewardNotice({ message, testID }: RewardNoticeProps) {
  return (
    <View style={styles.notice} testID={testID}>
      <Text style={styles.noticeText}>{message}</Text>
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
   * What the bar is measuring, e.g. "Progres Follow Facebook" - the subject
   * only. The numbers are carried solely by `accessibilityValue` below, so
   * a caller cannot compose a label that contradicts the announced value
   * (an over-completed task, `current > target`, previously produced a
   * label saying "150 dari 100" beside a value announcing 100).
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
    <View
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
   * decided here. False renders the unavailable treatment and attaches
   * `UNAVAILABLE_CTA_HINT`; the press handler still fires so the caller can
   * explain the state, but no caller in this slice mutates any balance.
   */
  readonly isSupported: boolean;
  readonly onPress: () => void;
  readonly testID: string;
};

export function RewardCta({ label, isSupported, onPress, testID }: RewardCtaProps) {
  return (
    <Pressable
      accessibilityHint={isSupported ? undefined : UNAVAILABLE_CTA_HINT}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.cta,
        isSupported ? styles.ctaSupported : styles.ctaUnavailable,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      <Text
        style={[styles.ctaText, isSupported ? styles.ctaTextSupported : styles.ctaTextUnavailable]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  cardCaption: {
    marginTop: -6,
    fontSize: 12,
    lineHeight: scaledLineHeight(12),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  pointsPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: RewardAccent.goldBorder,
    backgroundColor: RewardAccent.goldSoft,
  },
  pointsPillText: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    color: RewardAccent.gold,
  },
  previewBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 26, 0.4)',
  },
  previewBadgeText: {
    fontSize: 10.5,
    letterSpacing: 1,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
  },
  notice: {
    padding: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  noticeText: {
    fontSize: 11.5,
    lineHeight: scaledLineHeight(11.5),
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
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
    minHeight: 44,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
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
