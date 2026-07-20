import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { SeriesProgressProvider, useSeriesProgress } from '@/stores/series-progress';

afterEach(async () => {
  await AsyncStorage.clear();
});

function ProgressProbe({ seriesId }: { seriesId: string }) {
  const { isHydrated, getProgress, recordProgress } = useSeriesProgress();
  const progress = getProgress(seriesId);

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="video-id">{progress?.lastWatchedVideoId ?? ''}</Text>
      <Text testID="position">{String(progress?.positionSeconds ?? -1)}</Text>
      <Text
        testID="record"
        onPress={() => recordProgress(seriesId, 'video-2', 2, 30, 120)}>
        record
      </Text>
      <Text
        testID="record-near-end"
        onPress={() => recordProgress(seriesId, 'video-2', 2, 118, 120)}>
        record near end
      </Text>
      <Text
        testID="record-negative"
        onPress={() => recordProgress(seriesId, 'video-2', 2, -50, 120)}>
        record negative
      </Text>
    </>
  );
}

describe('SeriesProgressProvider', () => {
  it('restores persisted progress on mount', async () => {
    await setItem(STORAGE_KEYS.seriesProgress, 1, {
      progressBySeriesId: {
        'series-1': {
          lastWatchedVideoId: 'video-1',
          lastWatchedEpisodeNumber: 1,
          positionSeconds: 42,
          durationSeconds: 90,
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      },
    });

    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe seriesId="series-1" />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    expect(getByTestId('video-id').props.children).toBe('video-1');
    expect(getByTestId('position').props.children).toBe('42');
  });

  it('clamps a negative playback position to 0', async () => {
    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe seriesId="series-1" />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    getByTestId('record-negative').props.onPress();

    await waitFor(() => expect(getByTestId('video-id').props.children).toBe('video-2'));
    expect(getByTestId('position').props.children).toBe('0');
  });

  it('resets position to 0 within the completion threshold of the end', async () => {
    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe seriesId="series-1" />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    getByTestId('record-near-end').props.onPress();

    await waitFor(() => expect(getByTestId('video-id').props.children).toBe('video-2'));
    expect(getByTestId('position').props.children).toBe('0');
  });

  it('records a normal mid-episode position unchanged', async () => {
    const { getByTestId } = await render(
      <SeriesProgressProvider>
        <ProgressProbe seriesId="series-1" />
      </SeriesProgressProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    getByTestId('record').props.onPress();

    await waitFor(() => expect(getByTestId('video-id').props.children).toBe('video-2'));
    expect(getByTestId('position').props.children).toBe('30');
  });
});
