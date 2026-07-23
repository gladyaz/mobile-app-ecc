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
import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import { useVideoInteractions, VideoInteractionsProvider } from '@/stores/video-interactions';

/**
 * Regression tests for the Phase 9 QA cross-account local-storage bleed
 * defect: local interaction data was persisted under fixed, device-global
 * AsyncStorage keys instead of being scoped to the current identity, so a
 * second account logging in on the same device would incorrectly see (and
 * could even push to their own real backend record) the first account's
 * liked/saved state. These tests prove the identity-scoped storage fix.
 */

jest.mock('@/services/interactions/interactions-service');
jest.mock('@/stores/auth');

const mockedUseAuth = useAuth as jest.Mock;
const mockedGetInteractions = getInteractions as jest.Mock;
const mockedLikeVideo = likeVideo as jest.Mock;
const mockedUnlikeVideo = unlikeVideo as jest.Mock;
const mockedSaveVideo = saveVideo as jest.Mock;
const mockedUnsaveVideo = unsaveVideo as jest.Mock;

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
  const { isHydrated, getInteraction, toggleLike } = useVideoInteractions();
  const interaction = getInteraction('video-1');

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="liked">{String(interaction.isLiked)}</Text>
      <Text testID="saved">{String(interaction.isSaved)}</Text>
      <Text testID="toggle-like" onPress={() => toggleLike('video-1')}>
        toggle like
      </Text>
    </>
  );
}

describe('video-interactions identity-scoped storage', () => {
  it('(a) guest data is adopted by whichever account is the FIRST to log in on this device', async () => {
    mockGuest();

    const { getByTestId, rerender } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // Guest likes a video before ever logging in.
    await act(async () => {
      fireEvent.press(getByTestId('toggle-like'));
    });
    expect(getByTestId('liked').props.children).toBe('true');

    // First-ever login on this device.
    mockAuthenticated('user-1');

    await act(async () => {
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );
    });

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // The guest-accumulated like is adopted as user-1's starting local state.
    expect(getByTestId('liked').props.children).toBe('true');
    // And converges to the backend under user-1's own authenticated session.
    await waitFor(() => expect(mockedLikeVideo).toHaveBeenCalledWith('video-1'));
  });

  it('(b) a second, different account does NOT inherit the first account\'s (or guest) local state', async () => {
    mockGuest();

    const { getByTestId, rerender } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // Guest, then first account: liked + saved 3 videos worth of state
    // (represented here by a single like, sufficient to prove the bleed).
    await act(async () => {
      fireEvent.press(getByTestId('toggle-like'));
    });

    mockAuthenticated('user-1');
    await act(async () => {
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );
    });
    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    expect(getByTestId('liked').props.children).toBe('true');

    // Logout.
    mockGuest();
    await act(async () => {
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );
    });

    // A brand-new, never-seen-before account logs in on this same device.
    mockAuthenticated('user-2');
    await act(async () => {
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );
    });

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // This is the exact reproduced defect: user-2 must start genuinely
    // empty, not see user-1's (or the guest's) liked/saved state.
    expect(getByTestId('liked').props.children).toBe('false');
    expect(getByTestId('saved').props.children).toBe('false');
  });

  it('(c) logging back in as a PREVIOUSLY-seen account restores that account\'s own prior local state', async () => {
    // Seed user-1's own namespaced storage, simulating a real prior session
    // on this device (rather than re-deriving it via a live login flow).
    await setItem(`${STORAGE_KEYS.videoInteractions}:user-1`, 1, {
      interactions: { 'video-1': { isLiked: true, isSaved: false } },
    });

    // A different, previously-unseen account logs in first.
    mockAuthenticated('user-2');

    const { getByTestId, rerender } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    expect(getByTestId('liked').props.children).toBe('false');

    // Logout, then log back in as user-1 - a previously-established identity
    // on this device.
    mockGuest();
    await act(async () => {
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );
    });

    mockAuthenticated('user-1');
    await act(async () => {
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );
    });

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // user-1's own previously-stored state is restored - not empty, and not
    // user-2's state.
    expect(getByTestId('liked').props.children).toBe('true');
  });

  it('(d) a user action and a same-commit identity change do not persist data under the wrong identity\'s key', async () => {
    mockAuthenticated('user-1');

    const { getByTestId, rerender } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // Switch the auth mock to a DIFFERENT identity, then fire the user
    // action AND the identity-changing rerender inside the SAME `act()` -
    // reproducing the same-commit collision: the hydration effect (which
    // updates the identity ref) and any interaction-state-reactive effect
    // would both fire in this one commit.
    mockAuthenticated('user-2');

    await act(async () => {
      fireEvent.press(getByTestId('toggle-like'));
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );
    });

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    // user-2 must never inherit user-1's like action, no matter the timing.
    expect(getByTestId('liked').props.children).toBe('false');

    const user1Data = await getItem<{ interactions: Record<string, { isLiked: boolean }> }>(
      `${STORAGE_KEYS.videoInteractions}:user-1`,
      1
    );
    const user2Data = await getItem<{ interactions: Record<string, { isLiked: boolean }> }>(
      `${STORAGE_KEYS.videoInteractions}:user-2`,
      1
    );

    // The like belongs to user-1's storage slot, not user-2's.
    expect(user1Data?.interactions['video-1']?.isLiked).toBe(true);
    expect(user2Data?.interactions['video-1']?.isLiked ?? false).toBe(false);
  });

  it('(e) a stale in-flight first-login merge for a departed identity must not clobber the current identity\'s live state', async () => {
    // user-1 logs in, and its first-login merge kicks off a remote fetch that
    // we hold pending (never resolving until we say so).
    let resolveUser1Fetch!: (interactions: { videoId: string; isLiked: boolean; isSaved: boolean }[]) => void;
    const user1FetchPromise = new Promise<
      { videoId: string; isLiked: boolean; isSaved: boolean }[]
    >((resolve) => {
      resolveUser1Fetch = resolve;
    });
    mockedGetInteractions.mockReturnValueOnce(user1FetchPromise);

    mockAuthenticated('user-1');
    const { getByTestId, rerender } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );
    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    // user-1's merge fetch is now pending in-flight.

    // user-1 logs out, user-2 logs in and fully hydrates+merges (with its
    // own, immediately-resolving fetch) BEFORE user-1's fetch resolves.
    mockGuest();
    await act(async () => {
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
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
    mockedGetInteractions.mockReturnValueOnce(
      new Promise((resolve) => {
        setTimeout(
          () => resolve([{ videoId: 'video-1', isLiked: true, isSaved: false }]),
          0
        );
      })
    );
    mockAuthenticated('user-2');
    await act(async () => {
      rerender(
        <VideoInteractionsProvider>
          <InteractionsProbe />
        </VideoInteractionsProvider>
      );
    });
    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    await waitFor(() => expect(getByTestId('liked').props.children).toBe('true'));

    // Now, only after user-2's own merge has already converged, user-1's
    // long-pending fetch finally resolves.
    await act(async () => {
      resolveUser1Fetch([{ videoId: 'video-1', isLiked: false, isSaved: true }]);
      await user1FetchPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    // user-2's live state must remain exactly what user-2's own merge
    // produced - user-1's stale merge result must not have overwritten it.
    expect(getByTestId('liked').props.children).toBe('true');
    expect(getByTestId('saved').props.children).toBe('false');

    const user2Data = await getItem<{
      interactions: Record<string, { isLiked: boolean; isSaved: boolean }>;
    }>(`${STORAGE_KEYS.videoInteractions}:user-2`, 1);
    expect(user2Data?.interactions['video-1']).toEqual({ isLiked: true, isSaved: false });
  });
});
