import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedBottomGap } from '@/constants/theme';

export type FeedBottomAnchor = {
  /** Bottom offset for the metadata overlay and the action rail it contains. */
  readonly overlayBottom: number;
  /** Bottom offset for the playback progress bar, which sits below them. */
  readonly progressBottom: number;
};

/**
 * The one bottom anchor for everything pinned to the foot of a feed item, so
 * the metadata overlay, the action rail and the progress bar cannot drift
 * apart across screen sizes.
 *
 * Why this deliberately does NOT add the tab bar height - that addition was
 * the bug this hook replaces. The tabs navigator lays its bar out IN FLOW:
 * `BottomTabView` renders the screen container and the bar as flex siblings,
 * so a tab screen's box already ends at the top edge of the bar, and the bar
 * has already consumed `insets.bottom` through its own `paddingBottom`.
 * Adding `useBottomTabBarHeight()` inside that already-shortened box counted
 * the whole strip a second time and floated the overlay roughly
 * `49 + insets.bottom` px too high - visibly mid-video rather than near the
 * navbar.
 *
 * The inset only has to be applied by hand in the one case where no bar is
 * there to consume it: a hidden tab bar reports a height of 0, and the screen
 * then extends to the physical bottom edge, underneath the iOS home indicator
 * and the Android gesture area.
 */
export function useFeedBottomAnchor(): FeedBottomAnchor {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();

  const floor = tabBarHeight > 0 ? 0 : insets.bottom;

  return {
    progressBottom: floor,
    overlayBottom: floor + FeedBottomGap,
  };
}
