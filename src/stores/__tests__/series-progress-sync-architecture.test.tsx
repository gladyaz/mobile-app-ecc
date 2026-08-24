import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { getProgress as fetchRemoteProgress, upsertProgress } from '@/services/progress/progress-service';
import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import { SeriesProgressProvider, useSeriesProgress } from '@/stores/series-progress';

/**
 * Verification tests for the redesigned 9-M2 sync architecture, mirrored
 * from video-interactions-sync-architecture.test.tsx - see that file's
 * header comment for the full rationale and the 4 failure classes being
 * proven closed here.
 */

jest.mock('@/services/progress/progress-service');
jest.mock('@/stores/auth');

const mockedUseAuth = useAuth as jest.Mock;
const mockedFetchRemoteProgress = fetchRemoteProgress as jest.Mock;
const mockedUpsertProgress = upsertProgress as jest.Mock;

function mockAuthenticated() {
  mockedUseAuth.mockReturnValue({
    isAuthenticated: true,
    isHydrated: true,
    user: { id: 'user-1', name: 'Test', username: 'test', email: 'test@example.com' },
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
  const { isHydrated, getProgress, recordProgress, hasSyncFailures } = useSeriesProgress();
  const progress = getProgress('series-1');

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="video-id">{progress?.lastWatchedVideoId ?? ''}</Text>
      <Text testID="position">{String(progress?.positionSeconds ?? -1)}</Text>
      <Text testID="sync-failures">{String(hasSyncFailures)}</Text>
      <Text
        testID="record-30"
        onPress={() => recordProgress('series-1', 'video-2', 2, 30, 120)}>
        record 30
      </Text>
      <Text
        testID="record-45"
        onPress={() => recordProgress('series-1', 'video-2', 2, 45, 120)}>
        record 45
      </Text>
    </>
  );
}

describe('series-progress sync architecture', () => {
  it('(a) a single recordProgress call pushes the correct value', async () => {
    mockAuthenticated();

    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await act(async () => {
      getByTestId('record-30').props.onPress();
    });

    await waitFor(() => expect(getByTestId('position').props.children).toBe('30'));
    await waitFor(() => expect(mockedUpsertProgress).toHaveBeenCalledTimes(1));
    expect(mockedUpsertProgress).toHaveBeenCalledWith('series-1', 'video-2', 2, 30, 120);
  });

  it('(b) rapid double-recordProgress nets to the correct final value, both pushed in order', async () => {
    mockAuthenticated();

    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await act(async () => {
      getByTestId('record-30').props.onPress();
      getByTestId('record-45').props.onPress();
    });

    expect(getByTestId('position').props.children).toBe('45');

    await waitFor(() => expect(mockedUpsertProgress).toHaveBeenCalledTimes(2));
    expect(mockedUpsertProgress).toHaveBeenNthCalledWith(1, 'series-1', 'video-2', 2, 30, 120);
    expect(mockedUpsertProgress).toHaveBeenNthCalledWith(2, 'series-1', 'video-2', 2, 45, 120);
  });

  it('(c) a user action during the first-login merge convergence window is not lost', async () => {
    let resolveRemoteFetch: (value: readonly unknown[]) => void = () => {};
    const remoteFetchPromise = new Promise<readonly unknown[]>((resolve) => {
      resolveRemoteFetch = resolve;
    });
    mockedFetchRemoteProgress.mockReturnValue(remoteFetchPromise);
    mockAuthenticated();

    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    await waitFor(() => expect(mockedFetchRemoteProgress).toHaveBeenCalledTimes(1));

    await act(async () => {
      getByTestId('record-30').props.onPress();
    });

    expect(getByTestId('position').props.children).toBe('30');

    await act(async () => {
      resolveRemoteFetch([]);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(mockedUpsertProgress).toHaveBeenCalledWith('series-1', 'video-2', 2, 30, 120)
    );
  });

  it('(d) hydration alone does not enqueue anything and does not redundantly push already-converged data', async () => {
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
    mockedFetchRemoteProgress.mockResolvedValue([
      { seriesId: 'series-1', videoId: 'video-2', episodeNumber: 2, positionSeconds: 30, durationSeconds: 120 },
    ]);
    mockAuthenticated();

    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    expect(getByTestId('position').props.children).toBe('30');

    await waitFor(() => expect(mockedFetchRemoteProgress).toHaveBeenCalledTimes(1));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(mockedUpsertProgress).not.toHaveBeenCalled();
  });

  it('(e) exhausting retry attempts surfaces hasSyncFailures via the public interface', async () => {
    jest.useFakeTimers();

    try {
      mockAuthenticated();
      mockedUpsertProgress.mockRejectedValue(new Error('network error'));

      const { getByTestId } = await render(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await act(async () => {
        getByTestId('record-30').props.onPress();
      });

      // Drain through every retry backoff (1s, 2s, 3s, 4s) until the
      // MAX_SYNC_ATTEMPTS-th failure drops the command.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20000);
      });

      expect(mockedUpsertProgress).toHaveBeenCalledTimes(5);
      expect(getByTestId('sync-failures').props.children).toBe('true');
    } finally {
      jest.useRealTimers();
    }
  });

  it('(f) logout discards the pending queue so a retrying command never fires under a different user', async () => {
    jest.useFakeTimers();

    try {
      mockedUpsertProgress.mockRejectedValue(new Error('network error'));
      mockAuthenticated();

      const { getByTestId, rerender } = await render(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await act(async () => {
        getByTestId('record-30').props.onPress();
        await jest.advanceTimersByTimeAsync(0);
      });

      // The first push attempt failed and a retry is scheduled - the command
      // is still sitting in user-1's queue, awaiting its backoff.
      expect(mockedUpsertProgress).toHaveBeenCalledTimes(1);

      // Logout before the scheduled retry fires - the pending queue must be
      // discarded, per DECISIONS.md requirement #3 ("an account change must
      // never send one user's queued data under a different user's identity").
      mockedUseAuth.mockReturnValue({
        isAuthenticated: false,
        isHydrated: true,
        user: null,
        login: jest.fn(),
        logout: jest.fn(),
      });

      await act(async () => {
        rerender(
          <SeriesProgressProvider>
            <ProgressProbe />
          </SeriesProgressProvider>
        );
      });

      // Log in as a different user.
      mockedFetchRemoteProgress.mockResolvedValue([]);
      mockedUseAuth.mockReturnValue({
        isAuthenticated: true,
        isHydrated: true,
        user: { id: 'user-2', name: 'User Two', username: 'user2', email: 'user2@example.com' },
        login: jest.fn(),
        logout: jest.fn(),
      });

      await act(async () => {
        rerender(
          <SeriesProgressProvider>
            <ProgressProbe />
          </SeriesProgressProvider>
        );
      });

      // Advance well past when the discarded retry would otherwise have
      // fired, under user-2's now-active session.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20000);
      });

      // User-1's queued/retrying command must never fire again under
      // user-2's session - the queue was discarded on logout, not carried
      // across accounts.
      expect(mockedUpsertProgress).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('(g) a response that lands after an account change never writes the previous user\'s queue key', async () => {
    // The drain loop checked the session epoch before SENDING a command but
    // not after the response landed. In that window the queue ref has already
    // been replaced by the new session's queue, while the loop still holds the
    // PREVIOUS user's storage key - so it sliced the new user's command off
    // and wrote their remaining queue under the old user's key, to be replayed
    // under the old user's token at their next sign-in.
    //
    // The identity change removes the previous user's queue key, so
    // re-creating it is the exact, observable signature of the defect.
    const PREVIOUS_USER_QUEUE_KEY = '@mobile-app-ecc/series-progress-sync-queue:user-1';

    let resolveFirstUsersPush: ((value: unknown) => void) | undefined;

    mockedUpsertProgress.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstUsersPush = resolve;
        })
    );

    mockAuthenticated();

    const { getByTestId, rerender } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await act(async () => {
      getByTestId('record-30').props.onPress();
    });

    await waitFor(() => expect(mockedUpsertProgress).toHaveBeenCalledTimes(1));

    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      isHydrated: true,
      user: null,
      login: jest.fn(),
      logout: jest.fn(),
    });

    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });

    mockedUseAuth.mockReturnValue({
      isAuthenticated: true,
      isHydrated: true,
      user: { id: 'user-2', name: 'User Two', username: 'user2', email: 'user2@example.com' },
      login: jest.fn(),
      logout: jest.fn(),
    });

    await act(async () => {
      rerender(
        <SeriesProgressProvider>
          <ProgressProbe />
        </SeriesProgressProvider>
      );
    });

    // user-2 records a position of their own, held open the same way.
    mockedUpsertProgress.mockImplementationOnce(() => new Promise(() => {}));

    await act(async () => {
      getByTestId('record-45').props.onPress();
    });

    expect(await getItem(PREVIOUS_USER_QUEUE_KEY, 1)).toBeUndefined();

    await act(async () => {
      resolveFirstUsersPush?.({
        seriesId: 'series-1',
        videoId: 'video-2',
        episodeNumber: 2,
        positionSeconds: 30,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await getItem(PREVIOUS_USER_QUEUE_KEY, 1)).toBeUndefined();
  });

  it('(h) a failed first-login pull aborts the merge instead of overwriting the server and marking it synced', async () => {
    // Swallowing the pull failure made "the request failed" indistinguishable
    // from "this account has no remote progress". Every local entry then
    // looked like it needed a convergence push, so this device's positions
    // were written over the server's NEWER ones - and the synced flag was set
    // permanently, so the real remote progress would never be pulled here
    // again.
    const SYNCED_KEY = '@mobile-app-ecc/series-progress-synced:user-1';

    await setItem(`${STORAGE_KEYS.seriesProgress}:user-1`, 1, {
      progress: {
        'series-1': {
          lastWatchedVideoId: 'video-2',
          lastWatchedEpisodeNumber: 2,
          positionSeconds: 30,
          durationSeconds: 120,
          updatedAt: new Date(0).toISOString(),
        },
      },
    });

    mockedFetchRemoteProgress.mockRejectedValue(new Error('network error'));
    mockAuthenticated();

    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Nothing was pushed over the server's data, and the account was not
    // marked as having completed its first-login merge.
    expect(mockedUpsertProgress).not.toHaveBeenCalled();
    expect(await getItem(SYNCED_KEY, 1)).toBeUndefined();
  });
});
