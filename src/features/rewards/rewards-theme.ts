import { PixelRatio } from 'react-native';

import { Palette } from '@/constants/theme';

/**
 * Feature-local design tokens for the Rewards Center.
 *
 * Lives here rather than in `src/constants/theme.ts` so this slice adds no
 * shared-surface churn - the Rewards work can land, be reviewed, and be
 * reverted without touching a file every other screen imports. If a second
 * feature ever needs the reward accent, promote these into `Palette` then,
 * not speculatively now.
 *
 * The warm gold accent is the "reward" signal called for by the design
 * direction. Contrast, measured against the two backdrops it actually sits
 * on - cards use `Palette.surface` (#18181B), while anything rendered
 * directly in the screen's ScrollView sits on `Palette.background` (#0D0D0F):
 *   gold #F5B321 on surface     -> 9.6:1
 *   gold #F5B321 on background  -> 10.5:1
 *   Palette.text on surface     -> 15.9:1
 * Gold means "this figure is worth something": it is reserved for values and
 * progress fill. Preview and disclaimer surfaces deliberately use the orange
 * `Palette.primaryHover` family instead, so the two signals never blur. Gold
 * is never the sole carrier of meaning either - every accented state also
 * has a text label.
 */
export const RewardAccent = {
  gold: '#F5B321',
  /** Fill behind gold content. Kept low-alpha so gold text stays >= 7:1. */
  goldSoft: 'rgba(245, 179, 33, 0.13)',
  goldBorder: 'rgba(245, 179, 33, 0.34)',
  /**
   * Unfilled portion of a progress track. This value is load-bearing for
   * WCAG 1.4.11 (non-text contrast) and was chosen by solving for the point
   * where BOTH boundaries of the bar clear 3:1 at once:
   *   track vs. card surface #18181B -> 3.05:1
   *   gold fill vs. track            -> 3.00:1
   * Darkening it makes the empty track vanish into the card; lightening it
   * makes the gold fill vanish into the track. Do not "tidy" this to a
   * rounder hex without re-checking both ratios.
   */
  track: '#656570',
} as const;

/**
 * Styling for the "this CTA has no backend yet" state. Deliberately NOT
 * `Palette.textDisabled` (#52525B, 2.3:1 on surface): these controls are
 * still focusable and still announce a hint, so their label has to stay
 * readable. `Palette.textSecondary` is 6.9:1 on surface.
 */
export const RewardUnavailable = {
  text: Palette.textSecondary,
  border: Palette.border,
  background: Palette.surfaceMuted,
} as const;

/**
 * A literal `lineHeight` does NOT scale with the OS text-size setting, while
 * `fontSize` does. Pairing the two hardcoded clips ascenders and overlaps
 * lines at large accessibility sizes, so every multi-line style in this
 * feature derives its line height through here instead.
 *
 * `getFontScale()` is read when the enclosing `StyleSheet.create` runs
 * (module load), which matches how the platforms deliver a text-size change
 * anyway - both restart the app rather than re-laying-out a live screen.
 */
export function scaledLineHeight(fontSize: number, ratio = 1.45): number {
  return Math.round(fontSize * PixelRatio.getFontScale() * ratio);
}
