import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { getProgress as fetchRemoteProgress, upsertProgress } from '@/services/progress/progress-service';
import { setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
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
  const { isHydrated, getProgress, recordProgress } = useSeriesProgress();
  const progress = getProgress('series-1');

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="video-id">{progress?.lastWatchedVideoId ?? ''}</Text>
      <Text testID="position">{String(progress?.positionSeconds ?? -1)}</Text>
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
    await setItem(STORAGE_KEYS.seriesProgress, 1, {
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
});
