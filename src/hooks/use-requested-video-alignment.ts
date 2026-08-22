import { useEffect, useRef } from 'react';
import type { FlatList } from 'react-native';

import { resolveRequestedAlignment } from '@/utils/feed-alignment';

export type UseRequestedVideoAlignmentParams<ItemT> = {
  /** The same ref passed to the FlatList's own `ref` prop. */
  readonly flatListRef: React.RefObject<FlatList<ItemT> | null>;
  /**
   * Identity of ONE episode selection. Two selections of the same episode are
   * two requests and must both align; a request that merely survives on the
   * route across re-renders is one request and must align once. The route
   * carries `videoRequestId` for exactly this, and falls back to the video id
   * for a plain deep link that has no selection behind it.
   */
  readonly requestKey: string | undefined;
  /** The canonical video id the route asked for. */
  readonly requestedVideoId: string | undefined;
  /** The feed's video ids, in render order. */
  readonly videoIds: readonly string[];
  /** Measured feed page height; `null` until layout has reported it. */
  readonly pageExtent: number | null;
  /**
   * Called with the aligned video id at the moment the scroll is issued, so
   * the screen can make that episode active immediately instead of waiting
   * for a viewability callback to tell it what it already knows.
   */
  readonly onAligned: (videoId: string) => void;
};

export type RequestedVideoAlignmentState = {
  /**
   * The episode this hook still owes the feed a scroll for, if any. Any OTHER
   * scroll the screen might issue has to stand down while this is set, or two
   * scrolls land in the same commit and the later one wins.
   */
  readonly pendingVideoId: string | undefined;
};

/**
 * Performs exactly one deterministic alignment per episode selection: waits
 * until the feed actually contains the requested video AND the feed viewport
 * has been measured, then issues a single non-animated `scrollToOffset` to
 * that item's page. See `feed-alignment.ts` for the geometry this fixes.
 *
 * Why non-animated. An animated programmatic scroll travels through every
 * intervening item, which (a) marks each passed episode as watched and counts
 * each as an ad-pacing transition, and (b) ends in the platform's own
 * momentum-end event - which `useFeedPagingGuard` reads as a gesture landing
 * and would then "correct" back to within one item of where the viewer
 * started, undoing the jump. A single offset assignment produces neither.
 * That guard is deliberately left untouched: it still governs every manual
 * swipe exactly as before.
 */
export function useRequestedVideoAlignment<ItemT>({
  flatListRef,
  requestKey,
  requestedVideoId,
  videoIds,
  pageExtent,
  onAligned,
}: UseRequestedVideoAlignmentParams<ItemT>): RequestedVideoAlignmentState {
  const alignment = resolveRequestedAlignment({ requestedVideoId, videoIds, pageExtent });

  // Which request has already been answered. A ref, not state: settling must
  // not itself cause a render, and nothing rendered depends on it.
  const settledRequestKeyRef = useRef<string | undefined>(undefined);

  // Same stabilisation as the screen's own progress callbacks: the caller
  // rebuilds this closure on every render, and it must not re-trigger the
  // effect below.
  const onAlignedRef = useRef(onAligned);

  useEffect(() => {
    onAlignedRef.current = onAligned;
  }, [onAligned]);

  const alignmentStatus = alignment.status;
  const alignmentVideoId = alignment.status === 'none' ? undefined : alignment.videoId;
  const alignmentOffset = alignment.status === 'ready' ? alignment.offset : null;

  useEffect(() => {
    if (requestKey === undefined || settledRequestKeyRef.current === requestKey) {
      return;
    }

    // Not actionable yet - keep waiting rather than scrolling with a height
    // or a catalog that is not there.
    if (alignmentStatus === 'none' || alignmentStatus === 'pending') {
      return;
    }

    // Settled BEFORE the scroll, so nothing that this scroll itself provokes
    // (a re-render, a viewability pass, a re-measure reporting the same
    // height) can produce a second one.
    settledRequestKeyRef.current = requestKey;

    if (alignmentOffset === null || alignmentVideoId === undefined) {
      return;
    }

    flatListRef.current?.scrollToOffset({ offset: alignmentOffset, animated: false });
    onAlignedRef.current(alignmentVideoId);
  }, [requestKey, alignmentStatus, alignmentOffset, alignmentVideoId, flatListRef]);

  return {
    pendingVideoId: alignment.status === 'pending' ? alignment.videoId : undefined,
  };
}
