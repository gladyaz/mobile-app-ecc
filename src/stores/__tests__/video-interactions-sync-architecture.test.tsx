import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  getInteractions,
  likeVideo,
  saveVideo,
  unlikeVideo,
  unsaveVideo,
} from '@/services/interactions/interactions-service';
import { setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import { useVideoInteractions, VideoInteractionsProvider } from '@/stores/video-interactions';

/**
 * Verification tests for the redesigned 9-M2 sync architecture (explicit
 * per-action queue, ref-as-truth, direct-push merge - see DECISIONS.md
 * "Phase 9 resumed with a replacement architecture for 9-M2"). These prove
 * the new design actually closes the 3 failure classes that broke the
 * previous reactive diff-effect implementation (see the discarded stash
 * `wip: phase9-m2 blocked sync architecture`):
 *   (a) a single toggle pushes the correct direction
 *   (b) rapid double-toggle nets to the correct final state, no wrong-value push
 *   (c) a genuine user action during the first-login merge's convergence
 *       window is not lost - it's enqueued and eventually pushed
 *   (d) hydration alone does not enqueue anything and does not redundantly
 *       push already-converged data (cycle 3's exact failure mode)
 */

jest.mock('@/services/interactions/interactions-service');
jest.mock('@/stores/auth');

const mockedUseAuth = useAuth as jest.Mock;
const mockedGetInteractions = getInteractions as jest.Mock;
const mockedLikeVideo = likeVideo as jest.Mock;
const mockedUnlikeVideo = unlikeVideo as jest.Mock;
const mockedSaveVideo = saveVideo as jest.Mock;
const mockedUnsaveVideo = unsaveVideo as jest.Mock;

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
  mockedGetInteractions.mockResolvedValue([]);
  mockedLikeVideo.mockResolvedValue({ videoId: 'video-1', isLiked: true, likeCount: 1 });
  mockedUnlikeVideo.mockResolvedValue({ videoId: 'video-1', isLiked: false, likeCount: 0 });
  mockedSaveVideo.mockResolvedValue({ videoId: 'video-1', isSaved: true });
  mockedUnsaveVideo.mockResolvedValue({ videoId: 'video-1', isSaved: false });
});

afterEach(async () => {
  await AsyncStorage.clear();
});

function InteractionsProbe() {
  const { isHydrated, getInteraction, toggleLike, hasSyncFailures } = useVideoInteractions();
  const interaction = getInteraction('video-1');

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="liked">{String(interaction.isLiked)}</Text>
      <Text testID="sync-failures">{String(hasSyncFailures)}</Text>
      <Text testID="toggle-like" onPress={() => toggleLike('video-1')}>
        toggle like
      </Text>
    </>
  );
}

describe('video-interactions sync architecture', () => {
  it('(a) a single toggle pushes the correct direction', async () => {
    mockAuthenticated();

    const { getByTestId } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await act(async () => {
      fireEvent.press(getByTestId('toggle-like'));
    });

    await waitFor(() => expect(getByTestId('liked').props.children).toBe('true'));
    await waitFor(() => expect(mockedLikeVideo).toHaveBeenCalledTimes(1));

    expect(mockedLikeVideo).toHaveBeenCalledWith('video-1');
    expect(mockedUnlikeVideo).not.toHaveBeenCalled();
  });

  it('(b) rapid double-toggle nets to the correct final state with no wrong-value push', async () => {
    mockAuthenticated();

    const { getByTestId } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // Rapid double toggle: like then unlike, back-to-back, synchronously.
    await act(async () => {
      fireEvent.press(getByTestId('toggle-like'));
      fireEvent.press(getByTestId('toggle-like'));
    });

    // Net local state: back to not-liked.
    expect(getByTestId('liked').props.children).toBe('false');

    // The queue is strictly FIFO/globally ordered, so both commands drain in
    // the order they were enqueued: like, then unlike.
    await waitFor(() => expect(mockedUnlikeVideo).toHaveBeenCalledTimes(1));
    expect(mockedLikeVideo).toHaveBeenCalledTimes(1);

    const likeOrder = mockedLikeVideo.mock.invocationCallOrder[0];
    const unlikeOrder = mockedUnlikeVideo.mock.invocationCallOrder[0];
    expect(likeOrder).toBeLessThan(unlikeOrder);
  });

  it('(c) a user action during the first-login merge convergence window is not lost', async () => {
    // Defer the remote fetch so the merge's async work stays "in flight"
    // while the user performs a real action.
    let resolveRemoteFetch: (value: readonly unknown[]) => void = () => {};
    const remoteFetchPromise = new Promise<readonly unknown[]>((resolve) => {
      resolveRemoteFetch = resolve;
    });
    mockedGetInteractions.mockReturnValue(remoteFetchPromise);
    mockAuthenticated();

    const { getByTestId } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    // Give the merge effect a tick to start (call getInteractions) before we act.
    await waitFor(() => expect(mockedGetInteractions).toHaveBeenCalledTimes(1));

    // Genuine user action while the merge's fetch is still unresolved.
    await act(async () => {
      fireEvent.press(getByTestId('toggle-like'));
    });

    // The toggle is not blocked/deferred by the in-flight merge - it commits
    // locally and enqueues immediately, independent of the merge machinery.
    expect(getByTestId('liked').props.children).toBe('true');

    // Now let the merge's fetch resolve and the merge finish.
    await act(async () => {
      resolveRemoteFetch([]);
      await Promise.resolve();
    });

    // The user's action must still be pushed - not silently dropped.
    await waitFor(() => expect(mockedLikeVideo).toHaveBeenCalledWith('video-1'));
  });

  it('(d) hydration alone does not enqueue anything and does not redundantly push already-converged data', async () => {
    // Local storage already has an interaction that exactly matches what the
    // "remote" reports - i.e. already converged, nothing to sync.
    await setItem(`${STORAGE_KEYS.videoInteractions}:user-1`, 1, {
      interactions: { 'video-1': { isLiked: true, isSaved: false } },
    });
    mockedGetInteractions.mockResolvedValue([{ videoId: 'video-1', isLiked: true, isSaved: false }]);
    mockAuthenticated();

    const { getByTestId } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    expect(getByTestId('liked').props.children).toBe('true');

    // Let the first-login merge run to completion.
    await waitFor(() => expect(mockedGetInteractions).toHaveBeenCalledTimes(1));

    // Give any (incorrect) background push a real chance to fire before
    // asserting it never did - this is the non-vacuous part of the test.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(mockedLikeVideo).not.toHaveBeenCalled();
    expect(mockedUnlikeVideo).not.toHaveBeenCalled();
    expect(mockedSaveVideo).not.toHaveBeenCalled();
    expect(mockedUnsaveVideo).not.toHaveBeenCalled();
    expect(getByTestId('sync-failures').props.children).toBe('false');
  });

  it('(e) exhausting retry attempts surfaces hasSyncFailures via the public interface', async () => {
    jest.useFakeTimers();

    try {
      mockAuthenticated();
      mockedLikeVideo.mockRejectedValue(new Error('network error'));

      const { getByTestId, unmount } = await render(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await act(async () => {
        fireEvent.press(getByTestId('toggle-like'));
      });

      // Drain through every retry backoff (1s, 2s, 3s, 4s) until the
      // MAX_SYNC_ATTEMPTS-th failure drops the command.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20000);
      });

      expect(mockedLikeVideo).toHaveBeenCalledTimes(5);
      expect(getByTestId('sync-failures').props.children).toBe('true');

      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('(f) logout discards the pending queue so a retrying command never fires under a different user', async () => {
    jest.useFakeTimers();

    try {
      mockedLikeVideo.mockRejectedValue(new Error('network error'));
      mockAuthenticated();

      const { getByTestId, rerender } = await render(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await act(async () => {
        fireEvent.press(getByTestId('toggle-like'));
        await jest.advanceTimersByTimeAsync(0);
      });

      // The first push attempt failed and a retry is scheduled - the command
      // is still sitting in user-1's queue, awaiting its backoff.
      expect(mockedLikeVideo).toHaveBeenCalledTimes(1);

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
          <VideoInteractionsProvider>
            <InteractionsProbe />
          </VideoInteractionsProvider>
        );
      });

      // Log in as a different user.
      mockedGetInteractions.mockResolvedValue([]);
      mockedUseAuth.mockReturnValue({
        isAuthenticated: true,
        isHydrated: true,
        user: { id: 'user-2', name: 'User Two', username: 'user2', email: 'user2@example.com' },
        login: jest.fn(),
        logout: jest.fn(),
      });

      await act(async () => {
        rerender(
          <VideoInteractionsProvider>
            <InteractionsProbe />
          </VideoInteractionsProvider>
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
      expect(mockedLikeVideo).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
