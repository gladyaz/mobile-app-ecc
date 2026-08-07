import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Whether the app is currently in the foreground ('active' AppState). One of
 * the gates in the feed's single-playback-owner rule: a backgrounded app must
 * never hold a playing feed player, and only the active item may resume on
 * return to the foreground.
 */
export function useAppForeground(): boolean {
  // `currentState` can be null for a moment during a real iOS cold start (and
  // is absent in the Jest preset). Unknown is not background: only an
  // explicit background/inactive state may block playback, otherwise the feed
  // could stick paused at launch waiting for a change event that never fires.
  const [isAppForeground, setIsAppForeground] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      setIsAppForeground(nextAppState === 'active');
    });

    return () => subscription.remove();
  }, []);

  return isAppForeground;
}
