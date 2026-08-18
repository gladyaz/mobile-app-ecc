import {
  getNextEpisode,
  getSeriesById,
  groupVideosIntoSeries,
} from '@/services/videos/series-service';
import type { Video, VideoAccessTier } from '@/types/video';

function buildVideo(overrides: Partial<Video> & Pick<Video, 'id' | 'seriesId' | 'episodeNumber'>): Video {
  return {
    storageKey: `key-${overrides.id}`,
    playbackUrl: `https://media.example.com/${overrides.id}.mp4`,
    thumbnailUrl: `https://cdn.example.com/${overrides.id}.jpg`,
    title: 'Kontrak Cinta CEO Dingin',
    channelName: 'Mandarin Drama ID',
    category: 'CEO',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: 'A drama caption.',
    likeCount: 100,
    isSaved: false,
    // Real content by default; a case that needs a fixture says so.
    contentKind: 'drama',
    accessTier: 'free',
    ...overrides,
  };
}

/**
 * Deliberately INVERTED against the retired `episodeNumber <= 5` rule:
 * episode 1 is premium and episode 7 is free. Any code that goes back to
 * deciding access from the episode number fails these cases instead of
 * quietly agreeing with them.
 */
const SERIES_A_TIERS: Readonly<Record<number, VideoAccessTier>> = {
  1: 'premium',
  2: 'free',
  3: 'free',
  4: 'free',
  5: 'free',
  6: 'free',
  7: 'free',
};

const seriesAVideos: readonly Video[] = [3, 1, 7, 2, 6, 5, 4].map((episodeNumber) =>
  buildVideo({
    id: `series-a-ep-${episodeNumber}`,
    seriesId: 'series-a',
    episodeNumber,
    accessTier: SERIES_A_TIERS[episodeNumber],
  })
);

const seriesBVideos: readonly Video[] = [
  buildVideo({ id: 'series-b-ep-1', seriesId: 'series-b', episodeNumber: 1 }),
];

describe('groupVideosIntoSeries', () => {
  it('groups videos by seriesId', () => {
    const series = groupVideosIntoSeries([...seriesAVideos, ...seriesBVideos]);

    expect(series).toHaveLength(2);
    expect(series.map((s) => s.id).sort()).toEqual(['series-a', 'series-b']);
  });

  it('orders episodes numerically regardless of input order', () => {
    const series = groupVideosIntoSeries(seriesAVideos);
    const seriesA = series.find((s) => s.id === 'series-a');

    expect(seriesA?.episodes.map((episode) => episode.episodeNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("copies each episode's access state from the video's backend accessTier", () => {
    const series = groupVideosIntoSeries(seriesAVideos);
    const seriesA = series.find((s) => s.id === 'series-a');

    // Episode 1 is premium and episodes 6-7 are free - the exact opposite of
    // what the retired `episodeNumber <= FREE_EPISODE_LIMIT` rule produced.
    expect(
      seriesA?.episodes.filter((e) => e.accessType === 'premium').map((e) => e.episodeNumber)
    ).toEqual([1]);
    expect(
      seriesA?.episodes.filter((e) => e.accessType === 'free').map((e) => e.episodeNumber)
    ).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe('getSeriesById', () => {
  it('returns the series when it exists', () => {
    const series = getSeriesById([...seriesAVideos, ...seriesBVideos], 'series-b');

    expect(series?.id).toBe('series-b');
    expect(series?.episodeCount).toBe(1);
  });

  it('returns undefined for a missing series id', () => {
    const series = getSeriesById(seriesAVideos, 'series-does-not-exist');

    expect(series).toBeUndefined();
  });
});

describe('getNextEpisode', () => {
  it('returns the next episode when it exists', () => {
    const series = getSeriesById(seriesAVideos, 'series-a');

    expect(series).toBeDefined();
    expect(getNextEpisode(series!, 5)?.episodeNumber).toBe(6);
  });

  it('returns undefined when there is no next episode', () => {
    const series = getSeriesById(seriesBVideos, 'series-b');

    expect(series).toBeDefined();
    expect(getNextEpisode(series!, 1)).toBeUndefined();
  });
});
