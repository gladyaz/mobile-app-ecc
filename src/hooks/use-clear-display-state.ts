import { useCallback, useState } from 'react';

import type { ClearDisplayOrigin } from '@/constants/clear-display';

/**
 * Home's ownership of the feed-wide clear-display state, extracted so the
 * origin rule is unit-testable on its own.
 *
 * The state itself is unchanged from the baseline: ONE boolean for the whole
 * feed, lifted above the items so it survives FlatList recycling. What this
 * hook adds is WHY the display is clear:
 *
 * - A MANUAL clear (tap / pinch / Playback Settings switch) keeps the
 *   baseline product behavior verbatim: it persists across swipes.
 * - An AUTO clear (the idle timer) is a passive convenience, not an
 *   expressed intent - so when the active video changes it un-clears, and
 *   the next video starts with chrome visible and its own fresh countdown.
 *   The reset uses the same render-time "adjust state when a prop changes"
 *   pattern `DramaFeedItem` already uses for `wasActive`/`lastVideoId`
 *   (the React-documented alternative to a setState-in-effect).
 *
 * Restoring chrome always returns the origin to 'manual', so a stale 'auto'
 * marker can never outlive the clear it described.
 */
export function useClearDisplayState(activeVideoId: string | undefined): {
  readonly isClearDisplay: boolean;
  readonly setClearDisplay: (next: boolean, origin?: ClearDisplayOrigin) => void;
} {
  const [isClearDisplay, setIsClearDisplay] = useState(false);
  const [clearDisplayOrigin, setClearDisplayOrigin] = useState<ClearDisplayOrigin>('manual');
  const [lastActiveVideoId, setLastActiveVideoId] = useState(activeVideoId);

  if (lastActiveVideoId !== activeVideoId) {
    setLastActiveVideoId(activeVideoId);

    if (isClearDisplay && clearDisplayOrigin === 'auto') {
      setIsClearDisplay(false);
      setClearDisplayOrigin('manual');
    }
  }

  const setClearDisplay = useCallback(
    (next: boolean, origin: ClearDisplayOrigin = 'manual') => {
      setIsClearDisplay(next);
      setClearDisplayOrigin(next ? origin : 'manual');
    },
    []
  );

  return { isClearDisplay, setClearDisplay };
}
