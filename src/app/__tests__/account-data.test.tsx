import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import AccountDataScreen from '@/app/account-data';
import { ApiError } from '@/services/api/client';
import { deleteMyAccount } from '@/services/auth/account-deletion-service';
import { exportMyData } from '@/services/export/export-service';
import { clearPersistedProgressForIdentity } from '@/stores/series-progress';
import { clearPersistedInteractionsForIdentity } from '@/stores/video-interactions';
import type { UserExport } from '@/types/export';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

const mockLogout = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/services/auth/account-deletion-service');
jest.mock('@/services/export/export-service');
jest.mock('@/stores/video-interactions');
jest.mock('@/stores/series-progress');

const mockedDeleteMyAccount = deleteMyAccount as jest.MockedFunction<typeof deleteMyAccount>;
const mockedExportMyData = exportMyData as jest.MockedFunction<typeof exportMyData>;
const mockedClearInteractions = clearPersistedInteractionsForIdentity as jest.MockedFunction<
  typeof clearPersistedInteractionsForIdentity
>;
const mockedClearProgress = clearPersistedProgressForIdentity as jest.MockedFunction<
  typeof clearPersistedProgressForIdentity
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
  mockedClearInteractions.mockResolvedValue(undefined);
  mockedClearProgress.mockResolvedValue(undefined);
  mockedDeleteMyAccount.mockResolvedValue(undefined);
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

describe('AccountDataScreen - delete my account', () => {
  it('requires a current password before the confirmation dialog appears', async () => {
    const { getByTestId, getByText, queryByText } = await render(<AccountDataScreen />);

    await fireEvent.press(getByTestId('delete-account-submit'));

    expect(getByText('Password saat ini wajib diisi')).toBeTruthy();
    expect(queryByText('Hapus Akun Secara Permanen?')).toBeNull();
    expect(mockedDeleteMyAccount).not.toHaveBeenCalled();
  });

  it('shows an unmissable irreversible-confirmation dialog and does NOT call the API until confirmed', async () => {
    const { getByTestId, getByText, getAllByText } = await render(<AccountDataScreen />);

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'my-password');
    await fireEvent.press(getByTestId('delete-account-submit'));

    expect(getByText('Hapus Akun Secara Permanen?')).toBeTruthy();
    expect(getAllByText(/PERMANEN/).length).toBeGreaterThan(0);
    expect(getAllByText(/TIDAK BISA DIBATALKAN/).length).toBeGreaterThan(0);
    expect(mockedDeleteMyAccount).not.toHaveBeenCalled();
  });

  it('cancelling the confirmation genuinely blocks the action - no API call, no cleanup, no logout', async () => {
    const { getByTestId, getByText, queryByText } = await render(<AccountDataScreen />);

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'my-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByText('Batal'));

    expect(queryByText('Hapus Akun Secara Permanen?')).toBeNull();
    expect(mockedDeleteMyAccount).not.toHaveBeenCalled();
    expect(mockedClearInteractions).not.toHaveBeenCalled();
    expect(mockedClearProgress).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/login');
  });

  it('on confirmed success: calls the API, purges BOTH identity-scoped stores for the deleted user, then performs a full local sign-out and routes to /login', async () => {
    const { getByTestId } = await render(<AccountDataScreen />);

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(mockedDeleteMyAccount).toHaveBeenCalledWith('correct-password'));
    await waitFor(() => expect(mockedClearInteractions).toHaveBeenCalledWith('user_1'));
    await waitFor(() => expect(mockedClearProgress).toHaveBeenCalledWith('user_1'));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  it('purges cleanup with the identity captured BEFORE logout, not a live post-logout read (regression guard for a future refactor that re-reads mutable state)', async () => {
    // Stand-in for the exact failure mode under guard: a store whose `user`
    // is cleared on logout, the way a ref/live-state read (rather than a
    // value captured once before any cleanup/logout runs) would observe it.
    // If `handleConfirmDelete` were ever refactored to derive the cleanup
    // identity from a fresh read taken after `await logout()` instead of the
    // pre-deletion binding, this mock arrangement makes that read observe
    // `null` - so the cleanup calls below would receive the wrong identity
    // (or none at all) instead of the deleted user's real id.
    mockLogout.mockImplementation(async () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isHydrated: true,
        user: null,
        logout: mockLogout,
      });
    });

    const { getByTestId } = await render(<AccountDataScreen />);

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(mockedDeleteMyAccount).toHaveBeenCalledWith('correct-password'));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    // Must be the PRE-deletion id ('user_1'), never `undefined`/`null` and
    // never anything read after `logout()` cleared the mocked store above.
    expect(mockedClearInteractions).toHaveBeenCalledWith('user_1');
    expect(mockedClearProgress).toHaveBeenCalledWith('user_1');
  });

  it('disables the confirm button while the request is in flight (no double-submit)', async () => {
    const deferred = createDeferred<void>();
    mockedDeleteMyAccount.mockReturnValueOnce(deferred.promise);

    const { getByTestId } = await render(<AccountDataScreen />);

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(mockedDeleteMyAccount).toHaveBeenCalledTimes(1));

    await fireEvent.press(getByTestId('confirm-dialog-confirm'));
    expect(mockedDeleteMyAccount).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });
  });

  it('a wrong current password (401) surfaces a distinct message, does NOT clean up or sign out, and the user stays logged in', async () => {
    mockedDeleteMyAccount.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    const { getByTestId, getByText } = await render(<AccountDataScreen />);

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'wrong-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Password saat ini salah\./)).toBeTruthy());
    expect(mockedClearInteractions).not.toHaveBeenCalled();
    expect(mockedClearProgress).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/login');

    // Retry affordance: the dialog stays open and pressing confirm again re-attempts.
    mockedDeleteMyAccount.mockResolvedValueOnce(undefined);
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(mockedDeleteMyAccount).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it('a privileged account (403 ACCOUNT_DELETION_FORBIDDEN) surfaces a distinct message, not the generic or wrong-password one', async () => {
    mockedDeleteMyAccount.mockRejectedValueOnce(
      new ApiError(
        403,
        'ACCOUNT_DELETION_FORBIDDEN',
        'Self-service account deletion is not available for this account type'
      )
    );

    const { getByTestId, getByText, queryByText } = await render(<AccountDataScreen />);

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() =>
      expect(
        getByText(/Akun ini tidak bisa dihapus sendiri\. Jenis akun ini memerlukan proses penghapusan khusus\./)
      ).toBeTruthy()
    );
    expect(queryByText(/Password saat ini salah/)).toBeNull();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('a rate limit (429) surfaces a distinct message naming the 15-minute window, not the generic or wrong-password one', async () => {
    mockedDeleteMyAccount.mockRejectedValueOnce(
      new ApiError(429, 'HTTP_ERROR', 'ThrottlerException: Too Many Requests')
    );

    const { getByTestId, getByText, queryByText } = await render(<AccountDataScreen />);

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() =>
      expect(
        getByText(/Terlalu banyak percobaan\. Untuk keamanan akunmu, coba lagi dalam 15 menit\./)
      ).toBeTruthy()
    );
    expect(queryByText(/Password saat ini salah/)).toBeNull();
    expect(mockLogout).not.toHaveBeenCalled();
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
