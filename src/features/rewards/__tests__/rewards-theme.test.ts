import { Palette } from '@/constants/theme';
import {
  RewardAccent,
  RewardSurface,
  scaledLineHeight,
} from '@/features/rewards/rewards-theme';

/**
 * `rewards-theme.ts` documents contrast ratios in a comment and warns not to
 * "tidy" the track colour without re-checking them. A comment cannot fail a
 * build, so the load-bearing ratios are pinned here instead: a one-character
 * hex edit that drops the progress bar below WCAG 1.4.11 now breaks CI.
 */

/** WCAG 2.2 relative luminance for an opaque #rrggbb colour. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));

  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 1.4.11 non-text contrast minimum. */
const NON_TEXT_MINIMUM = 3;
/** WCAG 1.4.3 body-text contrast minimum. */
const BODY_TEXT_MINIMUM = 4.5;

describe('contrastRatio (the yardstick these tests use)', () => {
  it('measures the reference extremes correctly', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 5);
  });
});

describe('rewards progress bar - WCAG 1.4.11 non-text contrast', () => {
  it('keeps the unfilled track distinguishable from the card it sits on', () => {
    expect(contrastRatio(RewardAccent.track, Palette.surface)).toBeGreaterThanOrEqual(
      NON_TEXT_MINIMUM
    );
  });

  it('keeps the gold fill distinguishable from the track behind it', () => {
    // Both boundaries matter: darkening the track hides the empty portion,
    // lightening it hides the fill. The chosen value clears 3:1 on each.
    expect(contrastRatio(RewardAccent.gold, RewardAccent.track)).toBeGreaterThanOrEqual(
      NON_TEXT_MINIMUM
    );
  });
});

describe('rewards accent colours - WCAG 1.4.3 text contrast', () => {
  it('keeps gold readable on both backdrops it is rendered against', () => {
    expect(contrastRatio(RewardAccent.gold, Palette.surface)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
    expect(contrastRatio(RewardAccent.gold, Palette.background)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
  });

  it('keeps the preview/disclaimer orange readable on the page background', () => {
    expect(contrastRatio(Palette.primaryHover, Palette.background)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
  });

  it('keeps section headings and secondary copy readable', () => {
    expect(contrastRatio(Palette.textSecondary, Palette.background)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
    expect(contrastRatio(Palette.textSecondary, Palette.surface)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
    expect(contrastRatio(Palette.textSecondary, Palette.surfaceMuted)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
  });

  it('keeps the dark ink on a gold CTA readable', () => {
    // White on gold would be 1.9:1; the dark ink is why the supported CTA
    // state is legible at all.
    expect(contrastRatio(Palette.background, RewardAccent.gold)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
  });
});

describe('rewards card surfaces - WCAG 1.4.3 / 1.4.11', () => {
  it('keeps every value rendered on a reward card readable', () => {
    // The redesign darkens cards from Palette.surface (#18181B) so they read
    // as a distinct plane against the warm wash behind the top of the page.
    // Darkening a card only ever helps light text, but the ratios are pinned
    // rather than reasoned about, because the next edit to these hexes will
    // not come with the reasoning attached.
    expect(contrastRatio(Palette.text, RewardSurface.card)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
    expect(contrastRatio(Palette.textSecondary, RewardSurface.card)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
    expect(contrastRatio(RewardAccent.gold, RewardSurface.card)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
  });

  it('keeps the inner chips readable too', () => {
    // Day chips and milestone chips sit ON a card, so their own fill is the
    // backdrop their labels are measured against - not the card's.
    expect(contrastRatio(Palette.text, RewardSurface.chip)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
    expect(contrastRatio(Palette.textSecondary, RewardSurface.chip)).toBeGreaterThanOrEqual(
      BODY_TEXT_MINIMUM
    );
  });

  it('keeps a card distinguishable from the page and a chip from its card', () => {
    // WCAG 1.4.11: the boundary between a card and the page, and between a
    // chip and the card it sits on, is a meaningful UI edge. Both are drawn
    // with a border as well, so neither depends on the fill alone - but a
    // fill that vanishes entirely makes the border do all the work.
    expect(contrastRatio(RewardSurface.cardBorder, RewardSurface.card)).toBeGreaterThan(1);
    expect(contrastRatio(RewardSurface.chipBorder, RewardSurface.chip)).toBeGreaterThan(1);
    expect(contrastRatio(RewardSurface.card, Palette.background)).toBeGreaterThan(1);
  });
});

describe('scaledLineHeight', () => {
  it('scales a line box above its font size so glyphs are never clipped', () => {
    expect(scaledLineHeight(12)).toBeGreaterThan(12);
    expect(scaledLineHeight(20)).toBeGreaterThan(20);
  });

  it('grows proportionally with the font size', () => {
    expect(scaledLineHeight(24)).toBeGreaterThan(scaledLineHeight(12));
  });
});
