import { renderHook } from '@testing-library/react-native';
import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedBottomGap } from '@/constants/theme';
import { useFeedBottomAnchor } from '@/hooks/use-feed-bottom-anchor';

// expo-router/js-tabs pulls in expo-router's full Tabs implementation, which
// needs native modules unavailable under Jest. Only the one hook is needed.
jest.mock('expo-router/js-tabs', () => ({
  useBottomTabBarHeight: jest.fn(),
}));

// The library's shipped mock (installed globally in jest.setup.js) returns a
// fixed inset from a plain function, so it cannot be varied per case. These
// tests need to drive the inset directly, hence a local jest.fn.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(),
}));

const mockTabBarHeight = useBottomTabBarHeight as jest.MockedFunction<typeof useBottomTabBarHeight>;
const mockInsets = useSafeAreaInsets as jest.MockedFunction<typeof useSafeAreaInsets>;

function setEnvironment({
  tabBarHeight,
  bottomInset,
}: {
  tabBarHeight: number;
  bottomInset: number;
}) {
  mockTabBarHeight.mockReturnValue(tabBarHeight);
  mockInsets.mockReturnValue({ top: 0, right: 0, bottom: bottomInset, left: 0 });
}

describe('useFeedBottomAnchor', () => {
  it('does not add the tab bar height, because the tab screen box already ends above the bar', async () => {
    // Arrange: a visible bar of 49pt plus a 34pt home indicator - the shape
    // that previously pushed the overlay 83pt into the middle of the video.
    setEnvironment({ tabBarHeight: 83, bottomInset: 34 });

    // Act
    const { result } = await renderHook(() => useFeedBottomAnchor());

    // Assert
    expect(result.current.overlayBottom).toBe(FeedBottomGap);
    expect(result.current.progressBottom).toBe(0);
  });

  it('keeps the anchor stable when the tab bar height varies across devices', async () => {
    // Arrange: web (49 + 0) and a gesture-nav Android phone (49 + 24).
    setEnvironment({ tabBarHeight: 49, bottomInset: 0 });
    const web = (await renderHook(() => useFeedBottomAnchor())).result.current;

    setEnvironment({ tabBarHeight: 73, bottomInset: 24 });
    const android = (await renderHook(() => useFeedBottomAnchor())).result.current;

    // Assert: the overlay sits the same distance above the navbar on both,
    // rather than drifting by whatever that platform's bar happens to be.
    expect(web).toEqual(android);
    expect(web.overlayBottom).toBe(FeedBottomGap);
  });

  it('falls back to the safe-area inset when no tab bar is there to consume it', async () => {
    // Arrange: a hidden navbar reports height 0, so the screen now extends
    // under the iOS home indicator / Android gesture area.
    setEnvironment({ tabBarHeight: 0, bottomInset: 34 });

    // Act
    const { result } = await renderHook(() => useFeedBottomAnchor());

    // Assert: controls clear the gesture area instead of sitting on it.
    expect(result.current.progressBottom).toBe(34);
    expect(result.current.overlayBottom).toBe(34 + FeedBottomGap);
  });

  it('keeps the overlay exactly one gap above the progress bar in every configuration', async () => {
    // Arrange / Act / Assert
    for (const [tabBarHeight, bottomInset] of [
      [83, 34],
      [49, 0],
      [0, 34],
      [0, 0],
    ]) {
      setEnvironment({ tabBarHeight, bottomInset });

      const { result } = await renderHook(() => useFeedBottomAnchor());

      expect(result.current.overlayBottom - result.current.progressBottom).toBe(FeedBottomGap);
    }
  });
});
