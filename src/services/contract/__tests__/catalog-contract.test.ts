/**
 * V1 GUEST CATALOG CONTRACT LOCK.
 *
 * The product rule: Red Panda V1 is free content, so a viewer who has never
 * signed in opens the app and browses. Home's feed, Discover's grid and a
 * series' episode list are the whole data path behind that, and all three are
 * read ANONYMOUSLY.
 *
 * Why this suite exists in this shape:
 *
 * The screen-level proof already exists (`app/__tests__/guest-first-entry.test
 * .tsx` mounts Home signed out; `components/__tests__/drama-feed-item.test.tsx`
 * covers guest playback). Both mock `services/api/client`'s `request`, which is
 * exactly the seam a guest-access regression would hide behind: a call site
 * that started passing `{ requiresAuth: true }` still resolves under a mocked
 * `request`, so every one of those cases keeps passing while a real guest is
 * handed a bearer token they do not have and a refresh-on-401 they cannot
 * satisfy.
 *
 * So these cases run the REAL `request()` and stub `fetch` instead. What is
 * asserted is the actual outgoing HTTP call - specifically the ABSENCE of an
 * `Authorization` header - which is the only form of this claim that a
 * one-argument edit at a call site cannot slip past.
 *
 * Mock/demo data is forced OFF throughout: a guest must reach the real
 * catalog, and a suite that quietly satisfied itself from the bundled fixtures
 * would prove nothing about the shipped product.
 */
import { V1_CATALOG_ENDPOINTS } from '@/services/contract/v1-contract-manifest';
import { getSeriesCatalog, getSeriesDetail } from '@/services/series/series-catalog-service';
import { __resetTokenStoreForTests, setTokens } from '@/services/auth/token-store';
import { getVideoFeed } from '@/services/videos/video-service';

jest.mock('@/services/demo/demo-mode', () => ({ isDemoMode: jest.fn(() => false) }));

const BASE_URL = 'https://api.redpanda.invalid';

const ORIGINAL_USE_MOCK_DATA = process.env.EXPO_PUBLIC_USE_MOCK_DATA;
const ORIGINAL_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

/**
 * One `drama`/`free` row carrying every field the manifest claims the client
 * would break without, so "a guest receives the real catalog" is checkable
 * rather than asserted against an empty array.
 */
const FEED_ROW = {
  id: 'video-1',
  seriesId: 'series-1',
  title: 'Kontrak Cinta CEO Dingin',
  episodeNumber: 1,
  channelName: 'Mandarin Drama ID',
  caption: 'Pertemuan pertama.',
  category: 'CEO',
  storageKey: 'processed/ep-1.mp4',
  playbackUrl: 'https://media.redpanda.invalid/video-1.mp4',
  sourceLanguage: 'Mandarin',
  hasEmbeddedIndonesianSubtitle: true,
  likeCount: 128,
  contentKind: 'drama',
  accessTier: 'free',
};

const SERIES_ROW = {
  id: 'series-1',
  title: 'Kontrak Cinta CEO Dingin',
  coverUrl: null,
  category: 'CEO',
  sourceLanguage: 'Mandarin',
  episodeCount: 1,
  totalLikes: 128,
  hasPremiumEpisodes: false,
};

type CapturedCall = { readonly url: string; readonly headers: Record<string, string> };

let captured: CapturedCall[] = [];

/** Stubs global `fetch` so the REAL client, and its real header assembly, runs. */
function stubFetch(payload: unknown): void {
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
    (url: string, init?: RequestInit) => {
      captured.push({
        url,
        // Header assembly in `client.ts` produces a plain object literal;
        // reading it directly is what makes a stray `Authorization` visible.
        headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      });

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
      });
    }
  );
}

function authorizationHeaderOf(call: CapturedCall): string | undefined {
  const entry = Object.entries(call.headers).find(
    ([name]) => name.toLowerCase() === 'authorization'
  );

  return entry?.[1];
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  process.env.EXPO_PUBLIC_USE_MOCK_DATA = 'false';
  process.env.EXPO_PUBLIC_API_BASE_URL = BASE_URL;
  __resetTokenStoreForTests();
});

afterEach(() => {
  process.env.EXPO_PUBLIC_USE_MOCK_DATA = ORIGINAL_USE_MOCK_DATA;
  process.env.EXPO_PUBLIC_API_BASE_URL = ORIGINAL_BASE_URL;
  __resetTokenStoreForTests();
  (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
});

describe('the guest catalog endpoint manifest', () => {
  it('declares exactly the three routes a signed-out viewer reads', () => {
    expect(V1_CATALOG_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
      'GET videos/feed',
      'GET series',
      'GET series/:id',
    ]);
  });

  it('marks every one of them auth-optional, because V1 is free content', () => {
    // The single assertion this whole file exists to defend. If a future
    // change makes any catalog read require a session, it fails HERE, with the
    // product rule stated beside it, rather than as "the feed is empty until
    // you sign in" on a handset.
    V1_CATALOG_ENDPOINTS.forEach((endpoint) => {
      expect(endpoint.requiresAuth).toBe(false);
    });
  });

  it('names a real owning module for each route', () => {
    // A manifest entry whose consumer has been renamed or deleted is a stale
    // claim, and a stale claim is worse than none.
    V1_CATALOG_ENDPOINTS.forEach((endpoint) => {
      expect(endpoint.consumer).toMatch(/^services\/.+\.ts#\w+$/);
      expect(endpoint.requiredResponseFields.length).toBeGreaterThan(0);
    });
  });
});

describe('a signed-out viewer reaches the real catalog, unauthenticated', () => {
  it('GET /videos/feed carries no Authorization header', async () => {
    stubFetch([FEED_ROW]);

    const videos = await getVideoFeed();

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`${BASE_URL}/videos/feed`);
    expect(authorizationHeaderOf(captured[0])).toBeUndefined();
    // Reached the REAL catalog, not the bundled fixtures.
    expect(videos.map((video) => video.id)).toEqual(['video-1']);
    expect(videos[0].accessTier).toBe('free');
  });

  it('GET /series carries no Authorization header', async () => {
    stubFetch({ items: [SERIES_ROW] });

    const series = await getSeriesCatalog();

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`${BASE_URL}/series`);
    expect(authorizationHeaderOf(captured[0])).toBeUndefined();
    expect(series.map((entry) => entry.id)).toEqual(['series-1']);
  });

  it('GET /series/:id carries no Authorization header', async () => {
    stubFetch({ ...SERIES_ROW, episodes: [FEED_ROW] });

    const detail = await getSeriesDetail('series-1');

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`${BASE_URL}/series/series-1`);
    expect(authorizationHeaderOf(captured[0])).toBeUndefined();
    expect(detail?.episodes.map((episode) => episode.id)).toEqual(['video-1']);
  });
});

describe('the catalog is read the same way whether or not a session exists', () => {
  /**
   * The half that is easy to lose sight of. "Guest browsing works" is usually
   * tested with an empty token store, which passes just as well if the client
   * has quietly started attaching a token whenever it has one - and that is a
   * real regression, because it puts a browsable route back on the
   * refresh-and-retry-once path where an expired session becomes a forced
   * sign-in. Holding tokens and asserting the header is STILL absent is what
   * distinguishes "auth-optional" from "auth when convenient".
   */
  it.each([
    ['videos/feed', () => getVideoFeed(), [FEED_ROW] as unknown],
    ['series', () => getSeriesCatalog(), { items: [SERIES_ROW] } as unknown],
    ['series/:id', () => getSeriesDetail('series-1'), { ...SERIES_ROW, episodes: [] } as unknown],
  ])('sends %s anonymously even while a valid session is held', async (_path, call, payload) => {
    setTokens({ accessToken: 'live-access-token', refreshToken: 'live-refresh-token' });
    stubFetch(payload);

    await call();

    expect(captured).toHaveLength(1);
    expect(authorizationHeaderOf(captured[0])).toBeUndefined();
  });
});

describe('a catalog read can never sign a viewer out', () => {
  /**
   * The mechanism behind the product failure, pinned directly.
   *
   * `requiresAuth: true` does more than attach a header: on a 401 it spends
   * the refresh token, and if that rotation fails it calls
   * `clearTokensAndNotify()` - which `stores/auth.tsx` turns into a
   * client-side logout. Put a browsable catalog route on that path and a
   * viewer whose session merely expired is signed out by the act of opening
   * Home, then told to sign in to see free content.
   *
   * A guest-only assertion cannot see this: with an empty token store no
   * header is attached either way, so the naive case passes even while the
   * regression is present. Holding tokens and proving `auth/refresh` is never
   * reached is what actually closes it.
   */
  it('does not refresh, retry, or clear the session when the catalog answers 401', async () => {
    setTokens({ accessToken: 'expired-access-token', refreshToken: 'live-refresh-token' });

    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn((url: string) => {
      captured.push({ url, headers: {} });

      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ code: 'INVALID_ACCESS_TOKEN', message: 'Unauthenticated.' }),
      });
    });

    await expect(getVideoFeed()).rejects.toMatchObject({ status: 401 });

    // Exactly one call: the feed. No `auth/refresh`, and no second attempt.
    expect(captured.map((call) => call.url)).toEqual([`${BASE_URL}/videos/feed`]);
    expect(captured.some((call) => call.url.includes('auth/refresh'))).toBe(false);
  });
});

describe('guest catalog access needs no demo or mock fixture', () => {
  it('resolves the feed from the network with mock data explicitly disabled', async () => {
    // EXPO_PUBLIC_USE_MOCK_DATA=false and `isDemoMode()` mocked false, so the
    // only way a row can arrive is over the wire. A build that had come to
    // depend on the bundled catalog to show a guest anything would fetch
    // nothing at all here.
    process.env.EXPO_PUBLIC_USE_MOCK_DATA = 'false';
    stubFetch([FEED_ROW]);

    const videos = await getVideoFeed();

    expect(captured).toHaveLength(1);
    expect(videos).toHaveLength(1);
    expect(videos[0].playbackUrl).toBe(FEED_ROW.playbackUrl);
  });
});
