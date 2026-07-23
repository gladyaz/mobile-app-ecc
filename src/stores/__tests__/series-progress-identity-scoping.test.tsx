import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { getProgress as fetchRemoteProgress, upsertProgress } from '@/services/progress/progress-service';
import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import { SeriesProgressProvider, useSeriesProgress } from '@/stores/series-progress';

/**
 * Regression tests for the Phase 9 QA cross-account local-storage bleed
 * defect - mirrored from
 * `video-interactions-identity-scoping.test.tsx`. See that file's header
 * comment for the full rationale.
 */

jest.mock('@/services/progress/progress-service');
jest.mock('@/stores/auth');

const mockedUseAuth = useAuth as jest.Mock;
const mockedFetchRemoteProgress = fetchRemoteProgress as jest.Mock;
const mockedUpsertProgress = upsertProgress as jest.Mock;

function mockGuest() {
  mockedUseAuth.mockReturnValue({
    isAuthenticated: false,
    isHydrated: true,
    user: null,
    login: jest.fn(),
    logout: jest.fn(),
  });
}

function mockAuthenticated(id: string) {
  mockedUseAuth.mockReturnValue({
    isAuthenticated: true,
    isHydrated: true,
    user: { id, name: id, username: id, email: `${id}@example.com` },
    login: jest.fn(),
    logout: jest.fn(),
  });
}

beforeEach(() => {
  mockedFetchRemoteProgress.mockResolvedValue([]);
  mockedUpsertProgress.mockResolvedValue({
    seriesId: 'series-1',
    videoId: 'video-2',
    episodeNumber: 2,
    positionSeconds: 30,
  });
});

afterEach(async () => {
  await AsyncStorage.clear();
});

function ProgressProbe() {
  const { isHydrated, getProgress, recordProgress } = useSeriesProgress();
  const progress = getProgress('series-1');

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="video-id">{progress?.lastWatchedVideoId ?? ''}</Text>
      <Text testID="position">{String(progress?.positionSeconds ?? -1)}</Text>
      <Text
        testID="record"
        onPress={() => recordProgress('series-1', 'video-2', 2, 30, 120)}>
        record
      </Text>
    </>
  );
}

describe('series-progress identity-scoped storage', () => {
  it('(a) guest progress is adopted by whichever account is the FIRST to log in on this device', async () => {
    mockGuest();

    const { getByTestId, rerender } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // Guest records progress before ever logging in.
    await act(async () => {
      getByTestId('record').props.onPress();
    });
    expect(getByTestId('video-id').props.children).toBe('video-2');
    expect(getByTestId('position').props.children).toBe('30');

    // First-ever login on this device.
    mockAuthenticated('user-1');
    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // The guest-accumulated progress is adopted as user-1's starting state.
    expect(getByTestId('video-id').props.children).toBe('video-2');
    expect(getByTestId('position').props.children).toBe('30');
    // And converges to the backend under user-1's own authenticated session.
    await waitFor(() =>
      expect(mockedUpsertProgress).toHaveBeenCalledWith('series-1', 'video-2', 2, 30, 120)
    );
  });

  it('(b) a second, different account does NOT inherit the first account\'s (or guest) progress', async () => {
    mockGuest();

    const { getByTestId, rerender } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await act(async () => {
      getByTestId('record').props.onPress();
    });

    mockAuthenticated('user-1');
    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });
    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    expect(getByTestId('position').props.children).toBe('30');

    // Logout.
    mockGuest();
    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });

    // A brand-new, never-seen-before account logs in on this same device.
    mockAuthenticated('user-2');
    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // This is the exact reproduced defect: user-2 must start genuinely
    // empty, not see user-1's (or the guest's) progress.
    expect(getByTestId('video-id').props.children).toBe('');
    expect(getByTestId('position').props.children).toBe('-1');
  });

  it('(c) logging back in as a PREVIOUSLY-seen account restores that account\'s own prior progress', async () => {
    // Seed user-1's own namespaced storage, simulating a real prior session
    // on this device.
    await setItem(`${STORAGE_KEYS.seriesProgress}:user-1`, 1, {
      progressBySeriesId: {
        'series-1': {
          lastWatchedVideoId: 'video-2',
          lastWatchedEpisodeNumber: 2,
          positionSeconds: 30,
          durationSeconds: 120,
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      },
    });

    // A different, previously-unseen account logs in first.
    mockAuthenticated('user-2');

    const { getByTestId, rerender } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    expect(getByTestId('position').props.children).toBe('-1');

    // Logout, then log back in as user-1 - a previously-established identity
    // on this device.
    mockGuest();
    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });

    mockAuthenticated('user-1');
    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // user-1's own previously-stored progress is restored - not empty, and
    // not user-2's state.
    expect(getByTestId('video-id').props.children).toBe('video-2');
    expect(getByTestId('position').props.children).toBe('30');
  });

  it('(d) a user action and a same-commit identity change do not persist data under the wrong identity\'s key', async () => {
    mockAuthenticated('user-1');

    const { getByTestId, rerender } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // Switch the auth mock to a DIFFERENT identity, then fire the user
    // action AND the identity-changing rerender inside the SAME `act()` -
    // reproducing the same-commit collision.
    mockAuthenticated('user-2');

    await act(async () => {
      getByTestId('record').props.onPress();
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // user-2 must never inherit user-1's recorded progress, no matter the timing.
    expect(getByTestId('video-id').props.children).toBe('');
    expect(getByTestId('position').props.children).toBe('-1');

    const user1Data = await getItem<{
      progressBySeriesId: Record<string, { lastWatchedVideoId: string }>;
    }>(`${STORAGE_KEYS.seriesProgress}:user-1`, 1);
    const user2Data = await getItem<{
      progressBySeriesId: Record<string, { lastWatchedVideoId: string }>;
    }>(`${STORAGE_KEYS.seriesProgress}:user-2`, 1);

    // The progress belongs to user-1's storage slot, not user-2's.
    expect(user1Data?.progressBySeriesId['series-1']?.lastWatchedVideoId).toBe('video-2');
    expect(user2Data?.progressBySeriesId['series-1']).toBeUndefined();
  });

  it('(e) a stale in-flight first-login merge for a departed identity must not clobber the current identity\'s live state', async () => {
    // user-1 logs in, and its first-login merge kicks off a remote fetch that
    // we hold pending (never resolving until we say so).
    let resolveUser1Fetch!: (
      progress: {
        seriesId: string;
        videoId: string;
        episodeNumber: number;
        positionSeconds: number;
        durationSeconds: number;
      }[]
    ) => void;
    const user1FetchPromise = new Promise<
      {
        seriesId: string;
        videoId: string;
        episodeNumber: number;
        positionSeconds: number;
        durationSeconds: number;
      }[]
    >((resolve) => {
      resolveUser1Fetch = resolve;
    });
    mockedFetchRemoteProgress.mockReturnValueOnce(user1FetchPromise);

    mockAuthenticated('user-1');
    const { getByTestId, rerender } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );
    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    // user-1's merge fetch is now pending in-flight.

    // user-1 logs out, user-2 logs in and fully hydrates+merges (with its
    // own, immediately-resolving fetch) BEFORE user-1's fetch resolves.
    mockGuest();
    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });
    // Let the guest transition fully settle (its own hydration completes)
    // before switching identity again, so the next transition starts from a
    // clean, stable render rather than overlapping with this one.
    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // Resolved on a real macrotask (not immediately, on the same microtask
    // turn) so this fetch settles strictly after user-2's own identity
    // hydration (a separate, unrelated async chain) has fully committed -
    // isolating this test to the specific in-flight-merge-staleness
    // scenario under test, rather than incidentally depending on exact
    // microtask interleaving between hydration and merge.
    mockedFetchRemoteProgress.mockReturnValueOnce(
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve([
              {
                seriesId: 'series-1',
                videoId: 'video-9',
                episodeNumber: 9,
                positionSeconds: 90,
                durationSeconds: 900,
              },
            ]),
          0
        );
      })
    );
    mockAuthenticated('user-2');
    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });
    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    await waitFor(() => expect(getByTestId('video-id').props.children).toBe('video-9'));

    // Now, only after user-2's own merge has already converged, user-1's
    // long-pending fetch finally resolves with different, unrelated data.
    await act(async () => {
      resolveUser1Fetch([
        {
          seriesId: 'series-1',
          videoId: 'video-1',
          episodeNumber: 1,
          positionSeconds: 10,
          durationSeconds: 100,
        },
      ]);
      await user1FetchPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    // user-2's live state must remain exactly what user-2's own merge
    // produced - user-1's stale merge result must not have overwritten it.
    expect(getByTestId('video-id').props.children).toBe('video-9');
    expect(getByTestId('position').props.children).toBe('90');

    const user2Data = await getItem<{
      progressBySeriesId: Record<string, { lastWatchedVideoId: string; positionSeconds: number }>;
    }>(`${STORAGE_KEYS.seriesProgress}:user-2`, 1);
    expect(user2Data?.progressBySeriesId['series-1']?.lastWatchedVideoId).toBe('video-9');
    expect(user2Data?.progressBySeriesId['series-1']?.positionSeconds).toBe(90);
  });
});
