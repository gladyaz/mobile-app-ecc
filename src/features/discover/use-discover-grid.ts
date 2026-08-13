import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

export const DISCOVER_SCREEN_PADDING = 16;
export const DISCOVER_GRID_GAP = 10;

/** Below this a portrait poster stops being legible on a phone. */
export const MIN_POSTER_WIDTH = 100;
/** Above this the grid stops feeling like a catalog (tablets, landscape). */
export const MAX_POSTER_WIDTH = 180;
export const PREFERRED_POSTER_COLUMNS = 3;
export const MIN_POSTER_COLUMNS = 2;
// High enough that the grow loop can still satisfy MAX_POSTER_WIDTH on the
// widest supported surface (1366pt iPad Pro landscape needs 8).
export const MAX_POSTER_COLUMNS = 8;

/** Portrait poster ratio (width / height) used by every Discover poster. */
export const POSTER_ASPECT_RATIO = 2 / 3;

export function posterWidthForColumns(availableWidth: number, columns: number): number {
  return (availableWidth - DISCOVER_GRID_GAP * (columns - 1)) / columns;
}

/**
 * Resolves the column count from the width actually available to the grid.
 *
 * 3 columns is the preferred look, but it is not hardcoded: a narrow phone
 * (e.g. a 320pt iPhone SE, where 3 columns would leave ~89pt posters) steps
 * down to 2, and a wide screen steps up until posters stop being oversized.
 */
export function resolvePosterColumns(availableWidth: number): number {
  let columns = PREFERRED_POSTER_COLUMNS;

  while (
    columns > MIN_POSTER_COLUMNS &&
    posterWidthForColumns(availableWidth, columns) < MIN_POSTER_WIDTH
  ) {
    columns -= 1;
  }

  while (
    columns < MAX_POSTER_COLUMNS &&
    posterWidthForColumns(availableWidth, columns) > MAX_POSTER_WIDTH
  ) {
    columns += 1;
  }

  return columns;
}

export type DiscoverGrid = {
  readonly availableWidth: number;
  readonly columns: number;
  readonly posterWidth: number;
  /** Width of a Rankings "Top Hits" card in the horizontal featured rail. */
  readonly featuredPosterWidth: number;
};

/** Cards visible at once in the featured rail; the fraction hints scrollability. */
const FEATURED_CARDS_IN_VIEW = 2.4;

export function useDiscoverGrid(): DiscoverGrid {
  const { width } = useWindowDimensions();

  return useMemo(() => {
    const availableWidth = Math.max(width - DISCOVER_SCREEN_PADDING * 2, MIN_POSTER_WIDTH);
    const columns = resolvePosterColumns(availableWidth);

    return {
      availableWidth,
      columns,
      posterWidth: posterWidthForColumns(availableWidth, columns),
      featuredPosterWidth: Math.min(
        MAX_POSTER_WIDTH,
        posterWidthForColumns(availableWidth, FEATURED_CARDS_IN_VIEW)
      ),
    };
  }, [width]);
}
