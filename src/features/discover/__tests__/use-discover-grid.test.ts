import { renderHook } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import {
  DISCOVER_GRID_GAP,
  DISCOVER_SCREEN_PADDING,
  MAX_POSTER_WIDTH,
  MIN_POSTER_COLUMNS,
  MIN_POSTER_WIDTH,
  posterWidthForColumns,
  resolvePosterColumns,
  useDiscoverGrid,
} from '@/features/discover/use-discover-grid';

/** Logical widths of devices the app is expected to run on. */
const DEVICE_WIDTHS = [
  { label: 'iPhone SE (1st gen) 320pt', width: 320 },
  { label: 'iPhone SE (2nd gen) / 8 375pt', width: 375 },
  { label: 'iPhone 14 390pt', width: 390 },
  { label: 'iPhone 8 Plus 414pt', width: 414 },
  { label: 'iPhone 15 Pro Max 430pt', width: 430 },
  { label: 'iPad portrait 768pt', width: 768 },
  { label: 'iPad landscape 1024pt', width: 1024 },
] as const;

function availableWidthFor(deviceWidth: number): number {
  return deviceWidth - DISCOVER_SCREEN_PADDING * 2;
}

// `clearMocks` does not uninstall a spy, so each window-width spy below has to
// be restored or it would leak into the following tests.
afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolvePosterColumns', () => {
  it.each(DEVICE_WIDTHS)('keeps posters legible and inside the row on $label', ({ width }) => {
    const availableWidth = availableWidthFor(width);
    const columns = resolvePosterColumns(availableWidth);
    const posterWidth = posterWidthForColumns(availableWidth, columns);
    const consumedWidth = posterWidth * columns + DISCOVER_GRID_GAP * (columns - 1);

    expect(columns).toBeGreaterThanOrEqual(MIN_POSTER_COLUMNS);
    expect(posterWidth).toBeGreaterThanOrEqual(MIN_POSTER_WIDTH);
    expect(consumedWidth).toBeLessThanOrEqual(availableWidth + 0.001);
  });

  it('steps down to 2 columns on a 320pt phone, where 3 would leave ~89pt posters', () => {
    expect(posterWidthForColumns(availableWidthFor(320), 3)).toBeLessThan(MIN_POSTER_WIDTH);
    expect(resolvePosterColumns(availableWidthFor(320))).toBe(2);
  });

  it('uses the preferred 3 columns from 375pt upward', () => {
    expect(resolvePosterColumns(availableWidthFor(375))).toBe(3);
    expect(resolvePosterColumns(availableWidthFor(390))).toBe(3);
    expect(resolvePosterColumns(availableWidthFor(430))).toBe(3);
  });

  it('adds columns instead of stretching posters on tablet widths', () => {
    for (const width of [768, 1024, 1366]) {
      const availableWidth = availableWidthFor(width);
      const columns = resolvePosterColumns(availableWidth);

      expect(columns).toBeGreaterThan(3);
      expect(posterWidthForColumns(availableWidth, columns)).toBeLessThanOrEqual(MAX_POSTER_WIDTH);
    }
  });
});

/**
 * The hook is tested separately from the arithmetic because the screen's
 * horizontal padding and the hook's subtraction of it are coupled by
 * convention only - dropping the subtraction would leave every pure-function
 * assertion above green while the real last column overflowed.
 */
describe('useDiscoverGrid', () => {
  function mockWindowWidth(width: number) {
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width, height: 1000, scale: 2, fontScale: 1 });
  }

  it('subtracts the screen padding from the window width', async () => {
    mockWindowWidth(320);

    const { result } = await renderHook(() => useDiscoverGrid());

    expect(result.current.availableWidth).toBe(320 - DISCOVER_SCREEN_PADDING * 2);
    expect(result.current.columns).toBe(2);
    expect(result.current.posterWidth).toBeCloseTo(139, 5);
    expect(
      result.current.posterWidth * result.current.columns + DISCOVER_GRID_GAP
    ).toBeLessThanOrEqual(result.current.availableWidth);
  });

  it('keeps the featured rail card narrower than a full-width poster', async () => {
    mockWindowWidth(375);

    const { result } = await renderHook(() => useDiscoverGrid());

    expect(result.current.columns).toBe(3);
    expect(result.current.featuredPosterWidth).toBeGreaterThan(result.current.posterWidth);
    expect(result.current.featuredPosterWidth).toBeLessThan(result.current.availableWidth);
  });
});
