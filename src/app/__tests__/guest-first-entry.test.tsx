import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';

import HomeScreen from '@/app/(tabs)/index';
import { VideoCatalogProvider } from '@/features/videos/video-catalog-provider';
import { ApiError, request } from '@/services/api/client';
import { login, register } from '@/services/auth/auth-service';
import { __resetTokenStoreForTests, getTokens } from '@/services/auth/token-store';
import { Typography } from '@/constants/theme';
import { setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { AuthProvider } from '@/stores/auth';
import { EntitlementProvider } from '@/stores/entitlement';
import { LanguageProvider } from '@/stores/language';
import { SeriesProgressProvider } from '@/stores/series-progress';
import { ToastProvider } from '@/stores/toast';
import { VideoInteractionsProvider } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

/**
 * GUEST-FIRST APP ENTRY (2026-08-22).
 *
 * The product rule under test: a signed-out viewer opens the app and lands
 * on the Home video feed, loaded from the REAL catalog endpoint. Login is
 * not required to enter Home, to load the feed, or to read episode
 * metadata - and nothing along that path may create an account or sign
 * anyone in.
 *
 * These cases mount the SAME provider stack `app/_layout.tsx` builds, with
 * only two substitutions: the HTTP boundary (`services/api/client`'s
 * `request`) so the "real catalog API" claim is checkable rather than
 * assumed, and `DramaFeedItem` (its player is covered by its own suite, and
 * pulls native modules Jest has no host for). Everything auth-related -
 * `AuthProvider`, its AsyncStorage hydration, the token store - runs for
 * real, because that is exactly what these cases are about.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() },
  useIsFocused: () => true,
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}));

// Auto-mocked so the "no account was created" case can assert on the two
// entry points that could have created one.
jest.mock('@/services/auth/auth-service');

// The feed item's player, poster and chrome are covered by
// `components/__tests__/drama-feed-item.test.tsx`. Here it stands in for
// "the feed rendered a real catalog row," and reports the backend-resolved
// access tier so the premium cases below can assert on it.
jest.mock('@/components/drama-feed-item', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText, View: RNView } = require('react-native');

  return {
    DramaFeedItem: ({ video, isActive }: { video: Video; isActive: boolean }) =>
      ReactModule.createElement(
        RNView,
        { testID: `feed-item-${video.id}` },
        ReactModule.createElement(RNText, null, video.title),
        ReactModule.createElement(RNText, { testID: `tier-${video.id}` }, video.accessTier),
        ReactModule.createElement(
          RNText,
          { testID: `active-${video.id}` },
          isActive ? 'active' : 'inactive'
        )
      ),
  };
});

// Ad pacing is not part of app entry, and the controller reaches for the
// AdMob native module through its presenter registry.
jest.mock('@/services/ads/ad-controller', () => ({
  onVideoTransition: jest.fn(),
  recordVideoWatched: jest.fn(),
}));

jest.mock('@/services/analytics/analytics-queue', () => ({
  trackEvent: jest.fn(),
}));

// The one substituted boundary. Real services, real stores, real hydration
// sit on top of it, so what these cases assert about "the app called the
// catalog endpoint, unauthenticated" is the actual call the app makes.
jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return { ...actual, request: jest.fn() };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

// A backend feed carrying BOTH tiers, so "the tier came from the backend"
// is observable rather than inferred. Episode 2 is deliberately premium and
// episode 6 deliberately free - the inverse of the historical
// episodeNumber-based rule - so any client-side re-derivation would show up
// as a mismatch here.
const BACKEND_FEED = [
  {
    id: 'video-1',
    seriesId: 'series-ceo-dingin',
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber: 1,
    channelName: 'Mandarin Drama ID',
    caption: 'Pertemuan pertama yang mengubah hidup Lin Yue.',
    category: 'CEO',
    storageKey: 'processed/ep-1.mp4',
    playbackUrl: 'https://media.example.com/video-1.mp4',
    thumbnailUrl: 'https://cdn.example.com/video-1.jpg',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    likeCount: 12800,
    contentKind: 'drama',
    accessTier: 'free',
  },
  {
    id: 'video-2',
    seriesId: 'series-ceo-dingin',
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber: 2,
    channelName: 'Mandarin Drama ID',
    caption: 'Kontrak itu ditandatangani.',
    category: 'CEO',
    storageKey: 'processed/ep-2.mp4',
    playbackUrl: 'https://media.example.com/video-2.mp4',
    thumbnailUrl: 'https://cdn.example.com/video-2.jpg',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    likeCount: 9100,
    contentKind: 'drama',
    accessTier: 'premium',
  },
  {
    id: 'video-6',
    seriesId: 'series-ceo-dingin',
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber: 6,
    channelName: 'Mandarin Drama ID',
    caption: 'Akhir dari sebuah kontrak.',
    category: 'CEO',
    storageKey: 'processed/ep-6.mp4',
    playbackUrl: 'https://media.example.com/video-6.mp4',
    thumbnailUrl: 'https://cdn.example.com/video-6.jpg',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    likeCount: 7400,
    contentKind: 'drama',
    accessTier: 'free',
  },
];

/**
 * Mirrors `app/_layout.tsx`'s provider order exactly. Awaited by every case:
 * `render()` in this testing-library version is itself a thenable that
 * flushes pending effects - including the catalog fetch and the auth store's
 * AsyncStorage hydration - when awaited.
 */
function renderApp() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <AuthProvider>
          <EntitlementProvider>
            <VideoCatalogProvider>
              <VideoInteractionsProvider>
                <SeriesProgressProvider>
                  <HomeScreen />
                </SeriesProgressProvider>
              </VideoInteractionsProvider>
            </VideoCatalogProvider>
          </EntitlementProvider>
        </AuthProvider>
      </ToastProvider>
    </LanguageProvider>
  );
}

/** Every route this app could send someone to in order to authenticate. */
const AUTH_ROUTES = ['/login', '/register', '/login-whatsapp'];

function assertNoAuthRedirect() {
  for (const navigate of [router.replace, router.push, router.navigate] as jest.Mock[]) {
    for (const call of navigate.mock.calls) {
      const target = typeof call[0] === 'string' ? call[0] : (call[0]?.pathname ?? '');

      expect(AUTH_ROUTES).not.toContain(target);
    }
  }
}

beforeEach(() => {
  mockedRequest.mockImplementation((path: string) => {
    if (path === 'videos/feed') {
      return Promise.resolve(BACKEND_FEED) as never;
    }

    // Everything else in this app is genuinely account-scoped. A guest
    // reaching one would be the bug, so it fails the way the backend would.
    return Promise.reject(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Unauthenticated.')
    ) as never;
  });
});

afterEach(async () => {
  await AsyncStorage.clear();
  __resetTokenStoreForTests();
});

describe('guest-first app entry', () => {
  it('opens straight onto the Home feed while signed out, with no redirect to any auth route', async () => {
    // A: signed-out entry reaches Home. C: nothing redirects it away.
    const { getByTestId } = await renderApp();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    expect(getTokens()).toBeNull();
    assertNoAuthRedirect();
  });

  it('loads the feed from the REAL catalog endpoint, unauthenticated', async () => {
    // B: not bundled fixtures, not a guest-only duplicate feed - the same
    // `GET /videos/feed` the signed-in app uses. The contract documents it
    // as auth-optional, and the client sends no Authorization header, which
    // is why a guest gets content at all.
    const { getByTestId } = await renderApp();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    const feedCalls = mockedRequest.mock.calls.filter(([path]) => path === 'videos/feed');

    expect(feedCalls).toHaveLength(1);
    // No `{ requiresAuth: true }` config - the third argument is where the
    // client attaches a bearer token, and the feed deliberately does not.
    expect(feedCalls[0][2]).toBeUndefined();
  });

  it('renders every catalog row a signed-in viewer would see, premium ones included', async () => {
    // F: premium content stays VISIBLE to a guest. It is not filtered out
    // of the feed and no entitlement is faked for it - the truthful gate
    // lives at playback (see the drama-feed-item suite), not in the list.
    const { getByTestId } = await renderApp();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    expect(getByTestId('feed-item-video-2')).toBeTruthy();
    expect(getByTestId('feed-item-video-6')).toBeTruthy();
  });

  it('takes each episode access tier from the backend, never from the episode number', async () => {
    // E: the fixture inverts the historical "1-5 free, 6+ premium" rule, so
    // any client-side re-derivation would disagree with the backend here.
    const { getByTestId } = await renderApp();

    await waitFor(() => {
      expect(getByTestId('tier-video-1')).toBeTruthy();
    });

    expect(getByTestId('tier-video-1').props.children).toBe('free');
    expect(getByTestId('tier-video-2').props.children).toBe('premium');
    expect(getByTestId('tier-video-6').props.children).toBe('free');
  });

  it('creates no account and mints no session for a guest who only browses', async () => {
    // D: browsing is not a sign-up funnel. Neither auth entry point may be
    // reached, and no tokens may appear in the store or in storage.
    const { getByTestId } = await renderApp();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    expect(register).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(
      mockedRequest.mock.calls.some(([path]) => path.startsWith('auth/'))
    ).toBe(false);
    expect(getTokens()).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.auth)).toBeNull();
  });

  it('is untouched when WhatsApp sign-in is withdrawn from the release', async () => {
    // WITHDRAWAL REGRESSION (2026-09-03). V1 ships with
    // EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=false, which removes one LOGIN method.
    // Guest browsing is a different path entirely and must not notice: the
    // feed is auth-optional, so a change to what the login screen offers has
    // no business altering whether a signed-out viewer can watch anything.
    // Pinned because the failure mode would be silent and total - a viewer who
    // opens the app and finds an empty Home has no way to report "the WhatsApp
    // flag did this".
    const previous = process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED;

    process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'false';

    try {
      const { getByTestId } = await renderApp();

      await waitFor(() => {
        expect(getByTestId('feed-item-video-1')).toBeTruthy();
      });

      // Still the same unauthenticated catalog read, still no session.
      const feedCalls = mockedRequest.mock.calls.filter(([path]) => path === 'videos/feed');

      expect(feedCalls).toHaveLength(1);
      expect(feedCalls[0][2]).toBeUndefined();
      expect(getTokens()).toBeNull();
      assertNoAuthRedirect();
    } finally {
      if (previous === undefined) {
        delete process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED;
      } else {
        process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = previous;
      }
    }
  });

  it('adopts a restored session without re-routing, so hydration cannot loop', async () => {
    // L: asynchronous auth restoration must not bounce the viewer between
    // Home and an auth route. The feed is already up before hydration
    // settles, and a recovered session changes the tokens, not the route.
    await setItem(STORAGE_KEYS.auth, 3, {
      user: { id: 'user_001', name: 'Gladyaz', username: 'gladyaz', email: 'gladyaz@example.com' },
      tokens: { accessToken: 'restored-access', refreshToken: 'restored-refresh' },
    });

    const { getByTestId } = await renderApp();

    await waitFor(() => {
      expect(getTokens()?.accessToken).toBe('restored-access');
    });

    expect(getByTestId('feed-item-video-1')).toBeTruthy();
    assertNoAuthRedirect();
    // One feed fetch for the whole session change - a re-route loop would
    // remount the provider and show up as a second one.
    expect(mockedRequest.mock.calls.filter(([path]) => path === 'videos/feed')).toHaveLength(1);
  });
});

describe('guest-first app entry - signed-out feed placeholder', () => {
  it('does not fall back to bundled or fabricated videos when the catalog endpoint fails', async () => {
    // The backend stays authoritative even in failure: a guest sees the
    // real error state, never invented content that would misrepresent the
    // catalog.
    mockedRequest.mockImplementation(
      () => Promise.reject(new ApiError(0, 'NETWORK_ERROR', 'Network request failed.')) as never
    );

    const { queryByTestId, getByText } = await renderApp();

    await waitFor(() => {
      expect(getByText('Video gagal dimuat.')).toBeTruthy();
    });

    expect(queryByTestId('feed-item-video-1')).toBeNull();
    assertNoAuthRedirect();
  });
});

describe('home feed overlay typography hierarchy', () => {
  // UI polish (2026-08-22): the upper-left of the feed stacks the "Red Panda"
  // brand mark directly above the per-item video title. Both used to be
  // extraBold (16 and 18), which read as ONE oversized text block competing
  // with the video for attention. These pin the resulting hierarchy against
  // the shared token scale - never against a rendered box, so they survive a
  // device-metrics change but still fail if either line is resized on its own.

  it('renders the brand mark at the body token, below the title token', async () => {
    const { getByText } = await renderApp();

    const brandStyle = StyleSheet.flatten(getByText('Red Panda').props.style);

    expect(brandStyle.fontSize).toBe(Typography.body.fontSize);
    expect(brandStyle.fontFamily).toBe(Typography.body.fontFamily);
    // The whole point of the change: the brand line must not outrank, or tie
    // with, the video title that sits under it.
    expect(brandStyle.fontSize).toBeLessThan(Typography.title.fontSize);
    expect(brandStyle.fontFamily).not.toBe(Typography.title.fontFamily);
  });

  it('bounds the brand mark text scaling to the shared overlay cap', async () => {
    // The brand sits a fixed 34px above the title block, so an unbounded OS
    // text size is the one input that could grow it down into that title.
    const { getByText } = await renderApp();

    expect(getByText('Red Panda').props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.3);
  });

  it('keeps the brand mark left-aligned with the title block', async () => {
    // Both overlays anchor to the same left gutter; a hierarchy change must
    // not turn the upper-left stack into a ragged one.
    const { getByText } = await renderApp();

    const brandStyle = StyleSheet.flatten(getByText('Red Panda').props.style);

    expect(brandStyle.textAlign ?? 'left').toBe('left');
  });
});
