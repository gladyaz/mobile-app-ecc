import { mockDramaVideos } from '@/data/mock-drama-videos';
import { qaFixtureVideos } from '@/data/qa-fixture-videos';
import {
  mapBackendSeriesDetail,
  type BackendSeriesDetailDto,
} from '@/services/series/series-mapper';
import { getSeriesById, groupVideosIntoSeries, toEpisode } from '@/services/videos/series-service';
import { mapBackendVideoToVideo, type BackendVideoDto } from '@/services/videos/video-mapper';
import type { Video, VideoAccessTier } from '@/types/video';

/**
 * The authoritative episode access-tier contract (backend commit 2f285d1).
 *
 * The backend resolves ONE effective tier per episode - an explicit
 * per-episode admin override beats the episode-number default - and serves
 * it as `VideoResponseDto.accessTier` on `/videos/feed`, `/videos/:id` and
 * `/series/:id`'s embedded episodes. The SAME resolver guards `/stream` and
 * computes `SeriesPublicDto.hasPremiumEpisodes`, so a client that re-derives
 * access from the episode number can contradict the real authorization
 * decision.
 *
 * This app used to do exactly that (`getEpisodeAccessType(episodeNumber)`
 * against a local `FREE_EPISODE_LIMIT = 5`). Both are gone. Every case here
 * is built to FAIL if that rule is reintroduced anywhere on the path from
 * the wire to a rendered lock: each one pairs an episode number with the
 * opposite tier from what the old rule would have produced.
 */

function buildDto(overrides: Partial<BackendVideoDto> = {}): BackendVideoDto {
  return {
    id: 'video-104-01',
    seriesId: 'series-104',
    title: 'Drama Episode',
    episodeNumber: 1,
    channelName: 'VideoDracin Originals',
    caption: 'Episode caption.',
    category: 'action',
    storageKey: 'Series 104/1_subtitled.mp4',
    playbackUrl: 'https://media.example.com/video-104-01/stream',
    sourceLanguage: 'zh',
    hasEmbeddedIndonesianSubtitle: true,
    likeCount: 10,
    contentKind: 'drama',
    accessTier: 'free',
    ...overrides,
  };
}

/** Episode 2 premium, episode 8 free - the two Admin-override cases. */
const OVERRIDDEN_TIERS: Readonly<Record<number, VideoAccessTier>> = {
  1: 'free',
  2: 'premium',
  3: 'free',
  4: 'free',
  5: 'free',
  6: 'free',
  7: 'free',
  8: 'free',
  9: 'premium',
  10: 'premium',
};

function buildOverriddenEpisodeDtos(): readonly BackendVideoDto[] {
  return Object.keys(OVERRIDDEN_TIERS)
    .map(Number)
    .sort((left, right) => left - right)
    .map((episodeNumber) =>
      buildDto({
        id: `video-104-${String(episodeNumber).padStart(2, '0')}`,
        episodeNumber,
        accessTier: OVERRIDDEN_TIERS[episodeNumber],
      })
    );
}

describe('mapBackendVideoToVideo - accessTier', () => {
  it('maps a free episode to accessTier "free"', () => {
    expect(mapBackendVideoToVideo(buildDto({ accessTier: 'free' })).accessTier).toBe('free');
  });

  it('maps a premium episode to accessTier "premium"', () => {
    expect(mapBackendVideoToVideo(buildDto({ accessTier: 'premium' })).accessTier).toBe('premium');
  });

  it('never derives the tier from episodeNumber (early premium / late free)', () => {
    // Episode 2 declared premium: the retired rule would have said free.
    expect(
      mapBackendVideoToVideo(buildDto({ episodeNumber: 2, accessTier: 'premium' })).accessTier
    ).toBe('premium');
    // Episode 8 declared free: the retired rule would have said premium.
    expect(
      mapBackendVideoToVideo(buildDto({ episodeNumber: 8, accessTier: 'free' })).accessTier
    ).toBe('free');
  });

  it('ignores every other field that could tempt a client-side guess', () => {
    // A row whose episode number and title both point at "premium" but which
    // DECLARES itself free. The declaration must win.
    const declaredFree = mapBackendVideoToVideo(
      buildDto({
        episodeNumber: 40,
        title: 'Premium Finale',
        accessTier: 'free',
      })
    );

    expect(declaredFree.accessTier).toBe('free');
  });

  it('treats a missing or unrecognised accessTier as a contract error in development', () => {
    // __DEV__ is true under Jest, so the boundary fails loudly instead of
    // quietly inventing an access decision.
    expect(__DEV__).toBe(true);
    expect(() =>
      mapBackendVideoToVideo({ ...buildDto(), accessTier: undefined as unknown as string })
    ).toThrow(/accessTier/);
    expect(() => mapBackendVideoToVideo(buildDto({ accessTier: 'vip' }))).toThrow(/accessTier/);
    expect(() => mapBackendVideoToVideo(buildDto({ accessTier: 'Premium' }))).toThrow(/accessTier/);
  });

  it('never invents a tier outside the backend union', () => {
    const tiers = [1, 2, 8, 40].map(
      (episodeNumber) =>
        mapBackendVideoToVideo(
          buildDto({ episodeNumber, accessTier: OVERRIDDEN_TIERS[episodeNumber] ?? 'free' })
        ).accessTier
    );

    expect(tiers.every((tier) => tier === 'free' || tier === 'premium')).toBe(true);
  });
});

describe('accessTier survives the /videos/feed shape', () => {
  it('preserves each row tier verbatim across a mapped feed', () => {
    const feed = buildOverriddenEpisodeDtos().map(mapBackendVideoToVideo);

    expect(feed.map((video) => video.accessTier)).toEqual([
      'free',
      'premium',
      'free',
      'free',
      'free',
      'free',
      'free',
      'free',
      'premium',
      'premium',
    ]);
  });
});

describe('accessTier survives the /series/:id episode shape', () => {
  it('preserves the tier through mapBackendSeriesDetail', () => {
    const dto: BackendSeriesDetailDto = {
      id: 'series-104',
      title: 'Kontrak Cinta CEO Dingin',
      coverUrl: null,
      category: 'action',
      sourceLanguage: 'zh',
      episodeCount: 10,
      totalLikes: 700,
      hasPremiumEpisodes: true,
      episodes: buildOverriddenEpisodeDtos(),
    };

    const detail = mapBackendSeriesDetail(dto);

    expect(detail.episodes.find((episode) => episode.episodeNumber === 2)?.accessTier).toBe(
      'premium'
    );
    expect(detail.episodes.find((episode) => episode.episodeNumber === 8)?.accessTier).toBe('free');
  });
});

describe('toEpisode - Admin override regression', () => {
  function buildVideo(episodeNumber: number, accessTier: VideoAccessTier): Video {
    return mapBackendVideoToVideo(buildDto({ episodeNumber, accessTier }));
  }

  it('CASE A: episodeNumber 2 with accessTier "premium" becomes a premium episode', () => {
    expect(toEpisode(buildVideo(2, 'premium')).accessType).toBe('premium');
  });

  it('CASE B: episodeNumber 8 with accessTier "free" becomes a free episode', () => {
    expect(toEpisode(buildVideo(8, 'free')).accessType).toBe('free');
  });

  it('lets accessTier alone decide, for every episode number in the series', () => {
    const episodes = buildOverriddenEpisodeDtos().map(mapBackendVideoToVideo).map(toEpisode);

    expect(
      episodes.filter((episode) => episode.accessType === 'premium').map((e) => e.episodeNumber)
    ).toEqual([2, 9, 10]);
    expect(
      episodes.filter((episode) => episode.accessType === 'free').map((e) => e.episodeNumber)
    ).toEqual([1, 3, 4, 5, 6, 7, 8]);
  });

  it('produces the same access state for two episodes that differ ONLY in number', () => {
    // The one property episode number is now allowed to influence: none.
    expect(toEpisode(buildVideo(1, 'premium')).accessType).toBe(
      toEpisode(buildVideo(99, 'premium')).accessType
    );
    expect(toEpisode(buildVideo(1, 'free')).accessType).toBe(
      toEpisode(buildVideo(99, 'free')).accessType
    );
  });
});

describe('Home feed consumers read the same authoritative tier', () => {
  const videos: readonly Video[] = buildOverriddenEpisodeDtos().map(mapBackendVideoToVideo);

  it('resolves the next-episode gate from accessTier (Home overflow "next episode")', () => {
    // Home builds its Episode objects through getSeriesById -> toEpisode.
    const series = getSeriesById(videos, 'series-104');
    const nextAfterFirst = series?.episodes.find((episode) => episode.episodeNumber === 2);

    expect(nextAfterFirst?.accessType).toBe('premium');
  });

  it('resolves firstFreeEpisodeInSeries from accessTier, not from episode 1', () => {
    const premiumFirst = videos.map((video) =>
      video.episodeNumber === 1 ? { ...video, accessTier: 'premium' as const } : video
    );
    const series = getSeriesById(premiumFirst, 'series-104');
    const firstFree = series?.episodes.find(
      (episode) => episode.accessType === 'free' && episode.isAvailable
    );

    // Episodes 1 and 2 are both premium here, so the first free one is
    // episode 3 - a value no episode-number rule would produce.
    expect(firstFree?.episodeNumber).toBe(3);
  });

  it('keeps the grouped-series premium aggregate consistent with the episode tiers', () => {
    const [series] = groupVideosIntoSeries(videos);

    expect(series.episodes.some((episode) => episode.accessType === 'premium')).toBe(true);
  });
});

describe('offline/demo fixtures declare their own tier', () => {
  it('every bundled mock video carries an explicit accessTier', () => {
    expect(mockDramaVideos.length).toBeGreaterThan(0);
    expect(
      mockDramaVideos.every(
        (video) => video.accessTier === 'free' || video.accessTier === 'premium'
      )
    ).toBe(true);
  });

  it('keeps the bundled demo catalog free, so a demo viewer never hits an unclearable paywall', () => {
    expect(mockDramaVideos.every((video) => video.accessTier === 'free')).toBe(true);
  });

  it('keeps the 16:9 fullscreen QA fixture free so it can actually be played in QA', () => {
    expect(qaFixtureVideos).toHaveLength(1);
    expect(qaFixtureVideos[0].accessTier).toBe('free');
  });

  it('maps offline fixtures to episodes without consulting the episode number', () => {
    expect(mockDramaVideos.map((video) => toEpisode(video).accessType)).toEqual(
      mockDramaVideos.map((video) => video.accessTier)
    );
  });
});
