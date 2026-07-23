import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import { useVideoInteractions, VideoInteractionsProvider } from '@/stores/video-interactions';

jest.mock('@/stores/auth');

const mockedUseAuth = useAuth as jest.Mock;

beforeEach(() => {
  mockedUseAuth.mockReturnValue({
    isAuthenticated: false,
    isHydrated: true,
    user: null,
    login: jest.fn(),
    logout: jest.fn(),
  });
});

afterEach(async () => {
  await AsyncStorage.clear();
});

function InteractionsProbe() {
  const { isHydrated, getInteraction, savedVideoIds, toggleLike, toggleSave } =
    useVideoInteractions();
  const interaction = getInteraction('video-1');

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="liked">{String(interaction.isLiked)}</Text>
      <Text testID="saved-count">{String(savedVideoIds.length)}</Text>
      <Text testID="toggle-like" onPress={() => toggleLike('video-1')}>
        toggle like
      </Text>
      <Text testID="toggle-save" onPress={() => toggleSave('video-1')}>
        toggle save
      </Text>
    </>
  );
}

describe('VideoInteractionsProvider', () => {
  it('restores persisted liked/saved video IDs on mount', async () => {
    await setItem(STORAGE_KEYS.videoInteractions, 1, {
      interactions: { 'video-1': { isLiked: true, isSaved: true } },
    });

    const { getByTestId } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    expect(getByTestId('liked').props.children).toBe('true');
    expect(getByTestId('saved-count').props.children).toBe('1');
  });

  it('persists a toggled like so it survives a remount', async () => {
    const { getByTestId, unmount } = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('toggle-like'));
    await waitFor(() => expect(getByTestId('liked').props.children).toBe('true'));

    unmount();

    const remount = await render(
      <VideoInteractionsProvider>
        <InteractionsProbe />
      </VideoInteractionsProvider>
    );

    await waitFor(() =>
      expect(remount.getByTestId('hydrated').props.children).toBe('true')
    );
    expect(remount.getByTestId('liked').props.children).toBe('true');
  });
});
