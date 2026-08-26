import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { SeriesEpisodeRow } from '@/components/series-episode-row';
import { LanguageProvider } from '@/stores/language';
import type { Episode } from '@/types/series';

/**
 * Physical Android QA (2026-08-22) found every episode row showing a bare dark
 * rectangle where its still should be. Root cause was NOT a rendering bug: the
 * backend declares `VideoResponseDto.thumbnailUrl` but never populates it
 * (0/42 rows carry `Video.thumbnailImageKey`), and `video-mapper.ts` turns the
 * absent field into `''` - so the row asked `expo-image` to load an empty URI
 * and only its own near-black background painted.
 *
 * These pin the ORDER artwork resolves in and the guarantees around it, not
 * pixel geometry: the fixed-size box and the crop behaviour are style facts,
 * while "which URL wins, and what happens when it dies" is the behaviour that
 * would silently regress.
 */

const SERIES_COVER = 'https://media.example.com/series/series-1/cover.jpg?sig=abc';
const EPISODE_STILL = 'https://media.example.com/videos/video-1/thumb.jpg?sig=def';

function buildEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    videoId: 'video-1',
    seriesId: 'series-1',
    episodeNumber: 3,
    title: 'Kontrak Cinta CEO Dingin - Episode 3',
    // What the mapper actually produces today for every real row.
    thumbnailUrl: '',
    playbackUrl: 'https://media.example.com/video-1.mp4',
    accessType: 'free',
    isAvailable: true,
    hasEmbeddedIndonesianSubtitle: true,
    ...overrides,
  };
}

/**
 * `render()` in this testing-library version is itself a thenable that flushes
 * pending effects when awaited - the same call convention
 * `drama-feed-item.test.tsx` documents.
 */
/** `expo-image` normalises `source` into an array; this reads either shape. */
function sourceUri(node: { readonly props: Record<string, unknown> }): string | undefined {
  const source: unknown = node.props.source;
  const first = Array.isArray(source) ? source[0] : source;

  return (first as { uri?: string } | undefined)?.uri;
}

function renderRow(ui: ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('SeriesEpisodeRow artwork', () => {
  it('prefers the episode-specific still when the backend provides one', async () => {
    // The field the backend already declares. When it is finally populated,
    // the row must use it in preference to the series cover with no further
    // client change.
    const { getByTestId } = await renderRow(
      <SeriesEpisodeRow
        episode={buildEpisode({ thumbnailUrl: EPISODE_STILL })}
        isCurrentlyPlaying={false}
        seriesCoverUrl={SERIES_COVER}
      />
    );

    expect(sourceUri(getByTestId('series-episode-thumbnail'))).toBe(EPISODE_STILL);
  });

  it('falls back to the series cover when the episode has no still of its own', async () => {
    // Today's real state for every row in the catalog.
    const { getByTestId, queryByTestId } = await renderRow(
      <SeriesEpisodeRow
        episode={buildEpisode()}
        isCurrentlyPlaying={false}
        seriesCoverUrl={SERIES_COVER}
      />
    );

    expect(sourceUri(getByTestId('series-episode-thumbnail'))).toBe(SERIES_COVER);
    expect(queryByTestId('series-episode-thumbnail-fallback', { includeHiddenElements: true })).toBeNull();
  });

  it('never renders an empty-URI image - the blank-box regression itself', async () => {
    // The exact defect: `uri: ''` is a request that can only fail, leaving the
    // box painting nothing. With no artwork at all the row must show the
    // placeholder instead of asking for an empty URL.
    const { queryByTestId, getByTestId } = await renderRow(
      <SeriesEpisodeRow episode={buildEpisode()} isCurrentlyPlaying={false} seriesCoverUrl={null} />
    );

    expect(queryByTestId('series-episode-thumbnail')).toBeNull();
    expect(getByTestId('series-episode-thumbnail-fallback', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows the episode number as a deliberate placeholder when nothing is available', async () => {
    const { getByTestId } = await renderRow(
      <SeriesEpisodeRow
        episode={buildEpisode({ episodeNumber: 7 })}
        isCurrentlyPlaying={false}
      />
    );

    const fallback = getByTestId('series-episode-thumbnail-fallback', { includeHiddenElements: true });

    expect(fallback).toBeTruthy();
    expect(fallback.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('degrades to the next candidate when a presigned URL is broken or expired', async () => {
    // A signed R2 URL expires on a clock, not on a user action. The row must
    // drop to its placeholder rather than retry a dead URL forever.
    const { getByTestId, queryByTestId } = await renderRow(
      <SeriesEpisodeRow
        episode={buildEpisode()}
        isCurrentlyPlaying={false}
        seriesCoverUrl={SERIES_COVER}
      />
    );

    await act(async () => {
      fireEvent(getByTestId('series-episode-thumbnail'), 'error', {
        nativeEvent: { error: 'HTTP 403 (expired presigned URL)' },
      });
    });

    expect(queryByTestId('series-episode-thumbnail')).toBeNull();
    expect(getByTestId('series-episode-thumbnail-fallback', { includeHiddenElements: true })).toBeTruthy();
  });

  it('falls from a dead episode still through to the series cover, not to the placeholder', async () => {
    // Ordered degradation: one broken candidate must not skip the remaining
    // good one.
    const { getByTestId, queryByTestId } = await renderRow(
      <SeriesEpisodeRow
        episode={buildEpisode({ thumbnailUrl: EPISODE_STILL })}
        isCurrentlyPlaying={false}
        seriesCoverUrl={SERIES_COVER}
      />
    );

    await act(async () => {
      fireEvent(getByTestId('series-episode-thumbnail'), 'error', {
        nativeEvent: { error: 'HTTP 403 (expired presigned URL)' },
      });
    });

    expect(sourceUri(getByTestId('series-episode-thumbnail'))).toBe(SERIES_COVER);
    expect(queryByTestId('series-episode-thumbnail-fallback', { includeHiddenElements: true })).toBeNull();
  });

  it('crops rather than stretches, so a portrait cover in a landscape box is not distorted', async () => {
    const { getByTestId } = await renderRow(
      <SeriesEpisodeRow
        episode={buildEpisode()}
        isCurrentlyPlaying={false}
        seriesCoverUrl={SERIES_COVER}
      />
    );

    expect(getByTestId('series-episode-thumbnail').props.contentFit).toBe('cover');
  });

  it('keeps the artwork from intercepting the row tap', async () => {
    // The image sits inside the pressable row; a tap on it must still open the
    // episode.
    const onPress = jest.fn();
    const { getByRole } = await renderRow(
      <SeriesEpisodeRow
        episode={buildEpisode()}
        isCurrentlyPlaying={false}
        onPress={onPress}
        seriesCoverUrl={SERIES_COVER}
      />
    );

    fireEvent.press(getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps the current-episode highlight and its labels alongside the artwork', async () => {
    const { getByRole, getByText } = await renderRow(
      <SeriesEpisodeRow
        episode={buildEpisode()}
        isCurrentlyPlaying
        seriesCoverUrl={SERIES_COVER}
      />
    );

    expect(getByRole('button').props.accessibilityState.selected).toBe(true);
    expect(getByText('Episode 3')).toBeTruthy();
    expect(getByText('Sedang diputar')).toBeTruthy();
  });
});

describe('SeriesEpisodeRow access chip (V1 scope: free + ads)', () => {
  const ORIGINAL_PREMIUM_FLAG = process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED;

  afterEach(() => {
    process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = ORIGINAL_PREMIUM_FLAG;
  });

  it.each([
    ['free' as const, 'Gratis'],
    ['premium' as const, 'Premium'],
  ])('renders no %s access chip in V1', async (accessType, label) => {
    // V1 IS FREE + ADS: every episode is free, so the chip states a
    // distinction that does not exist. "Premium" would be worse than noise -
    // it reads as "this one costs something" in an app that sells nothing.
    const { queryByText } = await renderRow(
      <SeriesEpisodeRow episode={buildEpisode({ accessType })} isCurrentlyPlaying={false} />
    );

    expect(queryByText(label)).toBeNull();
  });

  it('still labels the row from the backend tier once the premium experience is on', async () => {
    // Pins the PRESERVED V1.1/V2 behaviour: the chip reads `accessType`
    // straight from the episode and is restored by a config change alone.
    process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = 'true';

    const { getByText } = await renderRow(
      <SeriesEpisodeRow episode={buildEpisode({ accessType: 'premium' })} isCurrentlyPlaying={false} />
    );

    expect(getByText('Premium')).toBeTruthy();
  });
});
