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

/**
 * Surfaces for the refined Rewards Center.
 *
 * Deliberately a touch darker than `Palette.surface` (#18181B): the redesign
 * puts a warm ambient wash behind the top of the page, and a card that sits
 * ON that wash needs to read as a distinct plane rather than dissolve into
 * it. Contrast against the values actually rendered on these fills is pinned
 * in `__tests__/rewards-theme.test.ts`, not just asserted here:
 *   Palette.text          on card #141417 -> 17.7:1
 *   Palette.textSecondary on card #141417 -> 7.5:1
 *   RewardAccent.gold     on card #141417 -> 11.1:1
 *
 * Kept feature-local for the same reason `RewardAccent` is: this slice adds
 * no churn to the file every other screen imports.
 */
export const RewardSurface = {
  card: '#141417',
  cardBorder: '#26262B',
  /** Inner chips (day chips, milestone chips) sitting ON a card. */
  chip: '#1C1C21',
  chipBorder: '#2E2E35',
} as const;

/**
 * The balance hero's warm gradient.
 *
 * Three stops rather than two so the card darkens toward its lower-left and
 * the balance keeps a calm backdrop, instead of a single flat wash that
 * fights the largest number on the page. Rendered through
 * `expo-linear-gradient`, which this app already ships and already uses for
 * its primary buttons - no blur, no shadow layers, nothing that costs a
 * frame on the low-end Android this demo targets.
 */
export const RewardHero = {
  gradient: ['#4E1A14', '#331419', '#1C1216'] as const,
  border: 'rgba(255, 138, 61, 0.32)',
  /** Soft light at the upper right, as one translucent circle. */
  glow: 'rgba(255, 168, 96, 0.16)',
} as const;

/**
 * The page-level warm wash behind the header and hero.
 *
 * Ends fully transparent so the rest of the scroll sits on the plain
 * near-black page background - the warmth is a top-of-page accent, not a
 * tint over the whole screen.
 */
export const RewardAmbient = {
  gradient: ['rgba(104, 28, 22, 0.55)', 'rgba(42, 17, 19, 0.24)', 'rgba(13, 13, 15, 0)'] as const,
} as const;
