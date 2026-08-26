import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import SeriesDetailScreen from '@/app/series/[id]';
import type { Video, VideoAccessTier } from '@/types/video';

const mockUseLocalSearchParams = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

const mockUseSeriesDetail = jest.fn();

// Detail fetches GET /series/:id by id. Nothing mocks the video catalog: the
// screen must not depend on Discover having populated anything.
jest.mock('@/features/series/use-series-catalog', () => ({
  useSeriesDetail: (id: string | undefined) => mockUseSeriesDetail(id),
}));

const mockGetProgress = jest.fn();

jest.mock('@/stores/series-progress', () => ({
  useSeriesProgress: () => ({ getProgress: mockGetProgress, recordProgress: jest.fn() }),
}));

const mockUseEntitlement = jest.fn();

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => mockUseEntitlement(),
}));

// Phase 11 (11-M3/11-M4): the screen now emits analytics events; the real
// queue schedules flush timers and hits the network, so it is mocked.
const mockTrackEvent = jest.fn();

jest.mock('@/services/analytics/analytics-queue', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

function buildEpisode(episodeNumber: number, accessTier: VideoAccessTier = 'free'): Video {
  return {
    id: `series-x-ep-${episodeNumber}`,
    seriesId: 'series-x',
    storageKey: `key-${episodeNumber}`,
    playbackUrl: `https://media.example.com/ep-${episodeNumber}.mp4`,
    thumbnailUrl: `https://cdn.example.com/ep-${episodeNumber}.jpg`,
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber,
    channelName: 'Mandarin Drama ID',
    category: 'CEO',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: `Episode ${episodeNumber} caption.`,
    likeCount: 100,
    isSaved: false,
    contentKind: 'drama',
    // Whatever the backend resolved for THIS episode. Never derived here.
    accessTier,
  };
}

/**
 * The historical shape - episodes 1-5 free, 6 premium. It now arrives that
 * way because the backend SAID so, not because the client counted episodes.
 * The behaviour the tests below assert is unchanged; only its source is.
 */
const seriesXVideos: readonly Video[] = [
  ...[1, 2, 3, 4, 5].map((episodeNumber) => buildEpisode(episodeNumber, 'free')),
  buildEpisode(6, 'premium'),
];

/** Canonical series title - deliberately NOT any episode's title. */
const CANONICAL_TITLE = 'Kontrak Cinta CEO Dingin';

beforeEach(() => {
  mockUseLocalSearchParams.mockReturnValue({ id: 'series-x' });
  mockUseSeriesDetail.mockReturnValue({
    data: {
      id: 'series-x',
      title: CANONICAL_TITLE,
      coverUrl: 'https://cdn.example.com/series-x.jpg',
      category: 'CEO',
      sourceLanguage: 'zh',
      episodeCount: seriesXVideos.length,
      totalLikes: 600,
      hasPremiumEpisodes: true,
      episodes: seriesXVideos,
    },
    isLoading: false,
    error: null,
    isNotFound: false,
    refresh: jest.fn(),
    recoverCover: jest.fn(),
  });
  mockGetProgress.mockReturnValue(undefined);
  mockUseEntitlement.mockReturnValue({ isPremium: false, refresh: jest.fn() });
});

/**
 * V1 IS FREE + ADS, so the DEFAULT for every test below is the premium
 * experience OFF. The blocks that assert a lock, a modal or an access chip
 * turn it on explicitly - they exist to prove that architecture is preserved
 * and restorable by configuration, not to describe what a V1 viewer meets.
 * See services/config/v1-scope.ts.
 */
const ORIGINAL_PREMIUM_FLAG = process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED;

function enablePremiumExperience() {
  process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = 'true';
}

afterEach(() => {
  process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = ORIGINAL_PREMIUM_FLAG;
});

describe('SeriesDetailScreen', () => {
  it('navigates to Home with the videoId when a free episode is selected', async () => {
    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 1'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'series-x-ep-1', videoRequestId: expect.any(String) },
    });
  });

  it('V1: opens a backend-premium episode like any other, with no modal and no lock', async () => {
    // V1 IS FREE + ADS. The client-side lock could only ever be a dead end
    // here - a dialog about a tier the viewer cannot obtain - so the tap goes
    // through to the feed, which asks the backend and renders its real answer.
    // Letting the tap through grants nothing: authorization is still server-side.
    const { getByText, queryByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 6'));

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'series-x-ep-6', videoRequestId: expect.any(String) },
    });
  });

  it('V1: emits episode_navigate, never premium_gate_hit, for a backend-premium episode', async () => {
    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 6'));

    expect(mockTrackEvent).toHaveBeenCalledWith('episode_navigate', {
      videoId: 'series-x-ep-6',
      seriesId: 'series-x',
      episodeNumber: 6,
      source: 'series-detail',
    });
    expect(mockTrackEvent).not.toHaveBeenCalledWith('premium_gate_hit', expect.anything());
  });

  it('V1: shows no access chip on any row, premium or free', async () => {
    const { queryByText, queryAllByText } = await render(<SeriesDetailScreen />);

    expect(queryByText('Premium')).toBeNull();
    expect(queryAllByText('Gratis')).toHaveLength(0);
  });

  it('emits an episode_navigate analytics event when a free episode is selected (Phase 11)', async () => {
    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 1'));

    expect(mockTrackEvent).toHaveBeenCalledWith('episode_navigate', {
      videoId: 'series-x-ep-1',
      seriesId: 'series-x',
      episodeNumber: 1,
      source: 'series-detail',
    });
  });

  it('blocks playback and shows the premium modal when a premium episode is selected', async () => {
    // PRESERVED V1.1/V2 BEHAVIOUR: the lock is intact and reads the backend
    // tier; only the V1 config keeps it out of a viewer's way.
    enablePremiumExperience();

    const { getByText, queryByText } = await render(<SeriesDetailScreen />);

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();

    await fireEvent.press(getByText('Episode 6'));

    expect(router.push).not.toHaveBeenCalled();
    expect(getByText('Episode ini termasuk konten premium.')).toBeTruthy();
  });

  it('emits a premium_gate_hit analytics event when a premium episode is blocked (Phase 11)', async () => {
    enablePremiumExperience();

    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 6'));

    expect(mockTrackEvent).toHaveBeenCalledWith('premium_gate_hit', {
      videoId: 'series-x-ep-6',
      seriesId: 'series-x',
      episodeNumber: 6,
      source: 'series-detail',
    });
  });

  it('plays a premium episode directly, without the modal, for an entitled user (Phase 10)', async () => {
    enablePremiumExperience();
    mockUseEntitlement.mockReturnValue({ isPremium: true, refresh: jest.fn() });

    const { getByText, queryByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 6'));

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'series-x-ep-6', videoRequestId: expect.any(String) },
    });
  });

  it('shows Continue Watching and the currently-playing indicator when progress exists', async () => {
    mockGetProgress.mockReturnValue({
      lastWatchedVideoId: 'series-x-ep-2',
      lastWatchedEpisodeNumber: 2,
    });

    const { getByText } = await render(<SeriesDetailScreen />);

    expect(getByText('Lanjutkan Menonton')).toBeTruthy();
    expect(getByText('Sedang diputar')).toBeTruthy();
  });
});

/**
 * The real Admin-override scenarios the backend contract exists to support
 * (backend commit 2f285d1). A 10-episode series where an admin has made an
 * EARLY episode premium and a LATE episode free - the exact inverse of the
 * retired `episodeNumber <= 5` client rule.
 *
 * Every assertion here fails if anyone reintroduces episode-number gating.
 */
describe('SeriesDetailScreen - authoritative access tier (Admin override)', () => {
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

  const overriddenEpisodes: readonly Video[] = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ].map((episodeNumber) => buildEpisode(episodeNumber, OVERRIDDEN_TIERS[episodeNumber]));

  beforeEach(() => {
    mockUseSeriesDetail.mockReturnValue({
      data: {
        id: 'series-x',
        title: CANONICAL_TITLE,
        coverUrl: 'https://cdn.example.com/series-x.jpg',
        category: 'CEO',
        sourceLanguage: 'zh',
        episodeCount: overriddenEpisodes.length,
        totalLikes: 600,
        // Backend-owned aggregate, resolved by the SAME rule - it agrees
        // with the episode tiers above rather than being recomputed here.
        hasPremiumEpisodes: true,
        episodes: overriddenEpisodes,
      },
      isLoading: false,
      error: null,
      isNotFound: false,
      refresh: jest.fn(),
      recoverCover: jest.fn(),
    });
  });

  it('V1: opens episode 2 with no lock, even though the backend calls it premium', async () => {
    // The tier PLUMBING is what this block exists to pin, and it is untouched:
    // the backend's per-episode answer still arrives intact. V1 simply does not
    // turn it into a lock.
    const { getByText, queryByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 2'));

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'series-x-ep-2', videoRequestId: expect.any(String) },
    });
  });

  it('CASE A: locks episode 2 and shows the premium modal when the backend says premium', async () => {
    enablePremiumExperience();

    const { getByText, queryByText } = await render(<SeriesDetailScreen />);

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();

    await fireEvent.press(getByText('Episode 2'));

    // An early episode that the old rule would have called free.
    expect(router.push).not.toHaveBeenCalled();
    expect(getByText('Episode ini termasuk konten premium.')).toBeTruthy();
  });

  it('CASE B: plays episode 8 without a modal when the backend says free', async () => {
    const { getByText, queryByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 8'));

    // A late episode that the old rule would have paywalled.
    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'series-x-ep-8', videoRequestId: expect.any(String) },
    });
  });

  it('labels each row from the backend tier, so the badge cannot contradict the gate', async () => {
    enablePremiumExperience();

    const { getAllByText } = await render(<SeriesDetailScreen />);

    // 3 premium (2, 9, 10) and 7 free - counted from the backend values, not
    // from any 5/6 boundary.
    // The default locale is Indonesian: the free badge reads "Gratis"
    // ("Free" was untranslated English sitting in the `id` block). "Premium"
    // is a loanword and is the same in all three locales.
    expect(getAllByText('Premium')).toHaveLength(3);
    expect(getAllByText('Gratis')).toHaveLength(7);
  });

  it('emits premium_gate_hit for the overridden EARLY episode, not for a late free one', async () => {
    enablePremiumExperience();

    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 2'));

    expect(mockTrackEvent).toHaveBeenCalledWith('premium_gate_hit', {
      videoId: 'series-x-ep-2',
      seriesId: 'series-x',
      episodeNumber: 2,
      source: 'series-detail',
    });
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      'premium_gate_hit',
      expect.objectContaining({ episodeNumber: 8 })
    );
  });

  it('still renders all 10 episode rows', async () => {
    const { getByText } = await render(<SeriesDetailScreen />);

    for (let episodeNumber = 1; episodeNumber <= 10; episodeNumber += 1) {
      expect(getByText(`Episode ${episodeNumber}`)).toBeTruthy();
    }
  });

  it('starts playback on the first BACKEND-free episode for a non-entitled user', async () => {
    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Mulai Menonton'));

    // Episode 1 is free here; if episode 1 were premium the button would
    // have to skip it. Either way the choice comes from accessTier.
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'series-x-ep-1', videoRequestId: expect.any(String) },
    });
  });

  it('gives every episode selection its own request id, re-picks included', async () => {
    // The feed uses `videoId` to decide WHICH episode to align to and
    // `videoRequestId` to decide WHETHER this is a new selection at all - a
    // param that merely survived on the route from an earlier pick must not
    // move the feed again. Picking the same episode twice therefore has to
    // produce two distinguishable requests.
    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 1'));
    await fireEvent.press(getByText('Episode 3'));
    await fireEvent.press(getByText('Episode 1'));

    const requests = (router.push as jest.Mock).mock.calls.map(([target]) => target.params);

    expect(requests.map((params) => params.videoId)).toEqual([
      'series-x-ep-1',
      'series-x-ep-3',
      'series-x-ep-1',
    ]);
    expect(new Set(requests.map((params) => params.videoRequestId)).size).toBe(3);
  });
});
