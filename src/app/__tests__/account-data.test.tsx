import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import AccountDataScreen from '@/app/account-data';
import { ApiError } from '@/services/api/client';
import { fetchDeletionMethods } from '@/services/auth/account-deletion-service';
import { exportMyData } from '@/services/export/export-service';
import type { UserExport } from '@/types/export';

/**
 * This screen's OWN behaviour: the auth guard, "Ekspor Data Saya", and the
 * fact that it still hosts the deletion surface.
 *
 * The deletion FLOW - method discovery, the three provider proofs, the
 * irreversible confirmation and the post-deletion cleanup - is covered by
 * `features/account-deletion/__tests__/delete-account-card.test.tsx` and
 * `.../delete-account-session-cleanup.test.tsx`, where that behaviour now
 * lives. Re-driving it through this screen would be the same assertions with
 * an extra wrapper, and would make a screen-layout change look like a
 * deletion regression.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

const mockLogout = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/services/auth/account-deletion-service');
jest.mock('@/services/auth/google-sign-in');
jest.mock('@/services/export/export-service');
jest.mock('@/stores/video-interactions');
jest.mock('@/stores/series-progress');

const mockedExportMyData = exportMyData as jest.MockedFunction<typeof exportMyData>;
const mockedFetchDeletionMethods = fetchDeletionMethods as jest.MockedFunction<
  typeof fetchDeletionMethods
>;

function buildExport(overrides?: Partial<UserExport>): UserExport {
  return {
    exportedAt: '2026-07-29T10:00:00.000Z',
    profile: {
      email: 'jane@example.com',
      displayName: 'Jane',
      memberSince: '2026-01-01T00:00:00.000Z',
    },
    interactions: [],
    watchProgress: [],
    entitlements: [],
    ...overrides,
  };
}

/** A promise whose resolution/rejection is controlled from the test body, so
 * loading states can be asserted before the async call settles. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isHydrated: true,
    user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    logout: mockLogout,
  });
  mockedFetchDeletionMethods.mockResolvedValue(['password']);
});

describe('AccountDataScreen - auth guard', () => {
  it('redirects to /login and renders nothing when not authenticated', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isHydrated: true,
      user: null,
      logout: mockLogout,
    });

    const { toJSON } = await render(<AccountDataScreen />);

    expect(router.replace).toHaveBeenCalledWith('/login');
    expect(toJSON()).toBeNull();
  });
});

describe('AccountDataScreen - export my data', () => {
  it('disables the export button while the request is in flight (no double-submit)', async () => {
    const deferred = createDeferred<UserExport>();
    mockedExportMyData.mockReturnValueOnce(deferred.promise);

    const { getByTestId } = await render(<AccountDataScreen />);

    await fireEvent.press(getByTestId('export-data-button'));
    await waitFor(() => expect(mockedExportMyData).toHaveBeenCalledTimes(1));

    await fireEvent.press(getByTestId('export-data-button'));
    expect(mockedExportMyData).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(buildExport());
      await deferred.promise;
    });
    // First heavy render in this file, so it pays the whole RN/Expo module-graph
    // transform cost. With a COLD Jest cache that measured ~761 ms on an M1
    // (233 ms warm); a slower CI runner plus this test's extra in-flight
    // deferred-promise cycle pushes it past Jest's 5000 ms default, which is
    // exactly how it failed on GitHub Actions at `813af73`. The timeout buys the
    // wall-clock cold-start needs; the double-submit assertion is unchanged.
  }, 15000);

  it('renders the exported payload on success', async () => {
    mockedExportMyData.mockResolvedValueOnce(buildExport());

    const { getByTestId, getByText } = await render(<AccountDataScreen />);

    await fireEvent.press(getByTestId('export-data-button'));

    await waitFor(() => expect(getByTestId('export-data-result')).toBeTruthy());
    expect(getByText(/jane@example\.com/)).toBeTruthy();
  });

  it('shows a distinct rate-limit message and a retry affordance on a 429', async () => {
    mockedExportMyData.mockRejectedValueOnce(
      new ApiError(429, 'HTTP_ERROR', 'ThrottlerException: Too Many Requests')
    );

    const { getByTestId, getByText } = await render(<AccountDataScreen />);

    await fireEvent.press(getByTestId('export-data-button'));

    await waitFor(() =>
      expect(
        getByText('Terlalu banyak permintaan ekspor data. Coba lagi dalam beberapa menit.')
      ).toBeTruthy()
    );

    mockedExportMyData.mockResolvedValueOnce(buildExport());
    await fireEvent.press(getByText('Coba Lagi'));

    await waitFor(() => expect(getByTestId('export-data-result')).toBeTruthy());
  });

  it('shows a generic error with a retry affordance for a non-429 failure', async () => {
    mockedExportMyData.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { getByTestId, getByText } = await render(<AccountDataScreen />);

    await fireEvent.press(getByTestId('export-data-button'));

    await waitFor(() =>
      expect(getByText('Gagal mengekspor data. Periksa koneksi kamu dan coba lagi.')).toBeTruthy()
    );
  });

  it('renders a realistically large payload (far taller than one screen) inside a vertically scrollable container, not clipped behind a horizontal-only scroller', async () => {
    // A handful of single-entry arrays (the rest of this suite's fixtures)
    // would never expose the clipping defect - this fixture is deliberately
    // large enough that the pretty-printed JSON is far taller than any phone
    // screen, matching a routine (not edge-case) amount of interactions,
    // watch progress, and entitlement history.
    const manyInteractions = Array.from({ length: 60 }, (_, i) => ({
      videoId: `video_${i}`,
      videoTitle: `Episode ${i}`,
      isLiked: i % 2 === 0,
      isSaved: i % 3 === 0,
      updatedAt: '2026-07-01T00:00:00.000Z',
    }));
    const manyWatchProgress = Array.from({ length: 60 }, (_, i) => ({
      seriesId: `series_${i}`,
      videoId: `video_${i}`,
      videoTitle: `Episode ${i}`,
      episodeNumber: i,
      positionSeconds: i * 10,
      durationSeconds: 120,
      updatedAt: '2026-07-02T00:00:00.000Z',
    }));
    const manyEntitlements = Array.from({ length: 30 }, (_, i) => ({
      tier: 'premium',
      source: 'dev_grant',
      grantedAt: '2026-01-05T00:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
    }));

    mockedExportMyData.mockResolvedValueOnce(
      buildExport({
        interactions: manyInteractions,
        watchProgress: manyWatchProgress,
        entitlements: manyEntitlements,
      })
    );

    const { getByTestId, getByText } = await render(<AccountDataScreen />);

    await fireEvent.press(getByTestId('export-data-button'));
    await waitFor(() => expect(getByTestId('export-data-result')).toBeTruthy());

    // The tail of a realistically large payload must actually be present in
    // the render tree (not truncated) ...
    expect(getByText(/video_59/)).toBeTruthy();

    // ... AND reachable: the scroll container wrapping the JSON must be a
    // VERTICAL scroller. A `horizontal` ScrollView has no vertical-scroll
    // affordance at all, so content past the visible fold would be
    // unreachable no matter how much of it is technically rendered - this
    // is the exact defect that shipped (every prior fixture was small enough
    // to never expose it).
    const scrollContainer = getByTestId('export-data-result-scroll');
    expect(scrollContainer.props.horizontal).not.toBe(true);
  });
});

describe('AccountDataScreen - no dev-only controls reachable', () => {
  it('never renders a dev-only control, regardless of __DEV__', async () => {
    const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const devRender = await render(<AccountDataScreen />);
    expect(devRender.queryByText(/devToken/i)).toBeNull();
    expect(devRender.queryByText(/dev token/i)).toBeNull();
    expect(devRender.queryByText(/reset local data/i)).toBeNull();
    await devRender.unmount();

    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    const prodRender = await render(<AccountDataScreen />);
    expect(prodRender.queryByText(/devToken/i)).toBeNull();
    expect(prodRender.queryByText(/dev token/i)).toBeNull();
    expect(prodRender.queryByText(/reset local data/i)).toBeNull();
    await prodRender.unmount();

    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });
});

describe('AccountDataScreen - hosts both personal-data actions', () => {
  it('renders the export action AND the deletion surface on the same screen', async () => {
    // The two live together because they are the same question - "what
    // happens to MY DATA" - and because Google Play expects the in-app
    // deletion route to be findable. A refactor that dropped the card from
    // this screen would leave the app with no reachable deletion path at all.
    const { getByTestId } = await render(<AccountDataScreen />);

    expect(getByTestId('export-data-button')).toBeTruthy();
    await waitFor(() => expect(getByTestId('delete-account-submit')).toBeTruthy());
  });

  it('asks the backend which deletion methods this account can use', async () => {
    // The screen must not re-derive this from identities, which is the guess
    // that used to offer a password field to a passwordless account.
    await render(<AccountDataScreen />);

    await waitFor(() => expect(mockedFetchDeletionMethods).toHaveBeenCalledTimes(1));
  });
});
