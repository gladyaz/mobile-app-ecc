import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  LayoutChangeEvent,
  ListRenderItem,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewToken,
  ViewabilityConfig,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DramaFeedItem } from '@/components/drama-feed-item';
import { FontFamily, Palette, Radius, Typography } from '@/constants/theme';
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import { useClearDisplayState } from '@/hooks/use-clear-display-state';
import { useFeedPagingGuard } from '@/hooks/use-feed-paging-guard';
import { useRequestedVideoAlignment } from '@/hooks/use-requested-video-alignment';
import { trackEvent } from '@/services/analytics/analytics-queue';
import { onVideoTransition } from '@/services/ads/ad-controller';
import { getNextEpisode, getSeriesById } from '@/services/videos/series-service';
import { useSeriesProgress } from '@/stores/series-progress';
import { useToast } from '@/stores/toast';
import { useTranslation } from '@/stores/language';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

type WebShareNavigator = {
  readonly clipboard?: {
    readonly writeText: (text: string) => Promise<void>;
  };
  readonly share?: (data: { readonly title?: string; readonly text?: string; readonly url?: string }) => Promise<void>;
};

const VIEWABILITY_CONFIG: ViewabilityConfig = {
  itemVisiblePercentThreshold: 80,
};

// Mobile UI revision (2026-08-12): distance below the top safe-area inset at
// which the brand overlay sits. The per-item title block renders 44px below
// the same inset (see `drama-feed-item.tsx`, TITLE_OVERLAY_TOP_OFFSET), so
// brand and title form one upper-left hierarchy that clears the
// notch/Dynamic Island on every screen instead of relying on a fixed 64px.
const BRAND_OVERLAY_TOP_OFFSET = 10;

// UI polish (2026-08-22): the brand mark is bounded to the same 1.3 text-scale
// cap the tab bar labels and the feed's episode cluster already use. It sits
// 34px above the per-item title block, so an unbounded OS text size is the one
// input that could grow it down INTO that title.
const BRAND_OVERLAY_MAX_FONT_SCALE = 1.3;

export default function HomeScreen() {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isScreenFocused = useIsFocused();

  // Phase 11 (11-M3): one feed_view event per time the Home feed gains
  // focus (mount and tab-switch-back alike). trackEvent is a plain module
  // function — silent no-op while logged out.
  useEffect(() => {
    if (isScreenFocused) {
      trackEvent('feed_view');
    }
  }, [isScreenFocused]);
  // `videoId` is the canonical target - the id of the exact episode that was
  // selected, never an episode number or a position. `videoRequestId`
  // identifies the SELECTION, so re-picking the same episode is a new request
  // while the same params merely surviving on the route is not (see
  // `video-request-id.ts`); a deep link that carries only `videoId` still
  // works, keyed on the id itself.
  const { videoId: requestedVideoId, videoRequestId } = useLocalSearchParams<{
    videoId?: string;
    videoRequestId?: string;
  }>();
  const { videos, isLoading, error, refresh } = useVideoCatalog();
  const { getInteraction, getLikeCount, toggleLike, toggleSave } = useVideoInteractions();
  const { getProgress, recordProgress } = useSeriesProgress();
  const { showToast } = useToast();
  // The feed's REAL page: the height of this screen's own box, which the tabs
  // navigator has already shortened by the in-flow tab bar below it. `null`
  // until `onLayout` reports it, because the window height is NOT a usable
  // stand-in - it is exactly the wrong number that misaligned every
  // programmatic episode jump (see `utils/feed-alignment.ts`). The window is
  // used only as the first-frame render size, never to compute a scroll.
  const [measuredPageExtent, setMeasuredPageExtent] = useState<number | null>(null);
  const pageExtent = measuredPageExtent ?? height;
  const [activeVideoId, setActiveVideoId] = useState<string | undefined>(undefined);
  // Web browsers block audible autoplay without a prior user gesture, so
  // the feed has to start muted there and let the sound toggle be the
  // gesture that turns audio on; native platforms aren't subject to that
  // restriction, so they can start audible. Lifted here (not local state
  // inside DramaFeedItem) so the preference survives each item unmounting
  // as it scrolls out of the FlatList's render window.
  const [isMuted, setIsMuted] = useState(Platform.OS === 'web');
  const requestedVideoIsInCatalog =
    requestedVideoId != null && videos.some((video) => video.id === requestedVideoId);
  const resolvedActiveVideoId =
    activeVideoId ?? (requestedVideoIsInCatalog ? requestedVideoId : videos[0]?.id);
  // Clear display lives here rather than inside a feed item so it survives
  // swiping between episodes. The hook adds the origin rule for the idle
  // auto-hide: a MANUAL clear persists across swipes exactly as before,
  // while an AUTO (idle-timer) clear un-clears when the active video
  // changes, so every newly-active video starts with visible chrome and its
  // own fresh countdown.
  const { isClearDisplay, setClearDisplay } = useClearDisplayState(resolvedActiveVideoId);
  const flatListRef = useRef<FlatList<Video>>(null);
  const videoIds = useMemo(() => videos.map((video) => video.id), [videos]);

  // A Series Detail episode selection returns here with ?videoId=... so the
  // selected episode plays in the existing feed player instead of a second,
  // duplicate player screen. The hook waits until the feed actually holds that
  // video AND the viewport has been measured, then performs exactly one
  // deterministic, non-animated alignment - and reports it, so the requested
  // episode becomes the active item at that instant rather than a viewability
  // callback later.
  const requestKey = videoRequestId ?? requestedVideoId;
  const { pendingVideoId } = useRequestedVideoAlignment({
    flatListRef,
    requestKey,
    requestedVideoId,
    videoIds,
    pageExtent: measuredPageExtent,
    onAligned: setActiveVideoId,
  });

  // FlatList throws if onViewableItemsChanged's identity ever changes after
  // mount ("Changing onViewableItemsChanged on the fly is not supported"),
  // so this callback's own deps must stay stable - getProgress can't be a
  // dependency since its identity changes with every progress update.
  // Reading it through a ref keeps the callback stable while still seeing
  // fresh progress.
  const getProgressRef = useRef(getProgress);

  useEffect(() => {
    getProgressRef.current = getProgress;
  }, [getProgress]);

  // Same instability class as getProgress above, and for the same
  // underlying reason: series-progress.tsx's recordProgress (transitively,
  // via enqueueCommand/drainQueue) depends on the current identity key,
  // which changes from the guest sentinel to the real user id at the exact
  // moment a login completes - crashing this screen's mounted FlatList if
  // a login happens while Home is on screen (found during Phase 10 manual
  // QA; this identity-key dependency chain predates Phase 10 and is
  // unrelated to it, just previously unobserved because no prior manual QA
  // pass logged in from an already-mounted Home feed).
  const recordProgressRef = useRef(recordProgress);

  useEffect(() => {
    recordProgressRef.current = recordProgress;
  }, [recordProgress]);

  // Slice 15A-S1: tracks the last video id this callback already evaluated
  // for ad pacing, so a repeated fire for the SAME item (initial layout,
  // the onLayout height change, re-entry into the 80% viewport - none of
  // which are a real transition) doesn't over-count. `undefined` means
  // "nothing evaluated yet in this mount," which also deliberately skips
  // the very first activation (app opened on video 1 is not a
  // "transition"). Resets on every HomeScreen remount, matching the
  // existing handledRequestedVideoIdRef idiom above.
  const lastAdCheckedVideoIdRef = useRef<string | undefined>(undefined);

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Video>[] }) => {
      const activeItem = viewableItems.find((viewableItem) => viewableItem.isViewable);

      if (!activeItem?.item) {
        return;
      }

      setActiveVideoId(activeItem.item.id);

      // Slice 15A-S1: onVideoTransition() is the counter-based interstitial
      // ad gate's entry point - it must fire exactly once per genuine
      // change of active video, never on a repeat fire for the same item,
      // and never for the very first activation. Module-level import, same
      // as trackEvent below — adds no dependency to this deliberately-
      // stable callback.
      if (lastAdCheckedVideoIdRef.current !== undefined
        && lastAdCheckedVideoIdRef.current !== activeItem.item.id) {
        onVideoTransition();
      }
      lastAdCheckedVideoIdRef.current = activeItem.item.id;

      // Phase 11 (11-M3): the definition of video_play is "this video
      // became the active feed item." Module-level import — adds no
      // dependency to this deliberately-stable callback.
      trackEvent('video_play', {
        videoId: activeItem.item.id,
        seriesId: activeItem.item.seriesId,
        episodeNumber: activeItem.item.episodeNumber,
      });

      // A video becoming viewable (e.g. on mount, or a scroll past it) only
      // confirms it as the last-watched item - it must not reset an
      // already-tracked playback position back to 0, or a resumed position
      // would be clobbered moments after being restored from storage.
      const existingProgress = getProgressRef.current(activeItem.item.seriesId);
      const isSameVideo = existingProgress?.lastWatchedVideoId === activeItem.item.id;

      recordProgressRef.current(
        activeItem.item.seriesId,
        activeItem.item.id,
        activeItem.item.episodeNumber,
        isSameVideo ? existingProgress.positionSeconds : 0,
        isSameVideo ? existingProgress.durationSeconds : undefined
      );
    },
    []
  );

  // Re-snap after the page extent changes - which is what a rotation does,
  // most visibly when returning from native fullscreen. `snapToInterval` and
  // `getItemLayout` are both derived from it, so once it changes the list's
  // current scroll offset was computed against the OLD extent and the feed
  // comes to rest between two items, showing a slice of each. Scrolling back
  // to the active index restores the one-item-per-screen invariant the pager
  // depends on.
  const previousPageExtentRef = useRef<number | null>(null);
  // Which episode selection the alignment above is answering, as of the last
  // time this effect ran. Both refs are only ever read and written HERE, in
  // the effect - never during render.
  const previousRequestKeyRef = useRef(requestKey);

  useEffect(() => {
    const isNewRequest = previousRequestKeyRef.current !== requestKey;

    previousRequestKeyRef.current = requestKey;

    if (measuredPageExtent === null) {
      return;
    }

    const previousPageExtent = previousPageExtentRef.current;

    // The FIRST measurement is not a change to re-snap for: the list is still
    // at offset 0, which is the right offset for any extent.
    if (previousPageExtent === null) {
      previousPageExtentRef.current = measuredPageExtent;
      return;
    }

    if (previousPageExtent === measuredPageExtent) {
      return;
    }

    // The alignment owns the scroll in any commit where it still owes one, or
    // where a new selection just arrived: it targets the REQUESTED episode,
    // while this effect can only see the previously active one - `onAligned`'s
    // state update does not land until the next render. Both firing in one
    // commit would let this one win with the stale target. The extent change
    // is deliberately NOT recorded below in that case, so the correction stays
    // owed and is made on the next run instead of being silently dropped.
    if (pendingVideoId !== undefined || isNewRequest) {
      return;
    }

    const activeIndex = videos.findIndex((video) => video.id === resolvedActiveVideoId);

    if (activeIndex < 0) {
      return;
    }

    previousPageExtentRef.current = measuredPageExtent;

    flatListRef.current?.scrollToOffset({
      offset: measuredPageExtent * activeIndex,
      animated: false,
    });
  }, [measuredPageExtent, videos, resolvedActiveVideoId, pendingVideoId, requestKey]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;

    // A zero/degenerate height is a transient layout state, not a page size.
    // Accepting one would hand every consumer below a meaningless extent.
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
      return;
    }

    setMeasuredPageExtent((currentExtent) =>
      currentExtent === nextHeight ? currentExtent : nextHeight
    );
  }, []);

  // Issue 2 (11R physical-QA remediation): a single continuous swipe/flick,
  // at any velocity, must move the feed by at most ±1 index from wherever it
  // started. `disableIntervalMomentum` below is the right platform primitive
  // but is not itself a guarantee - see `feed-paging.ts` and
  // `use-feed-paging-guard.ts` for why a deterministic corrective backstop
  // is still needed.
  const { onScrollBeginDrag, onMomentumScrollEnd } = useFeedPagingGuard({
    flatListRef,
    itemHeight: pageExtent,
    itemCount: videos.length,
  });

  const handleShare = useCallback(async (video: Video) => {
    const message = `${video.title} - Episode ${video.episodeNumber}\n${video.caption}\n${video.playbackUrl}`;

    try {
      if (Platform.OS === 'web') {
        const webNavigator = (globalThis as { readonly navigator?: WebShareNavigator }).navigator;

        if (webNavigator?.share) {
          await webNavigator.share({
            title: video.title,
            text: message,
            url: video.playbackUrl,
          });
          return;
        }

        if (webNavigator?.clipboard?.writeText) {
          await webNavigator.clipboard.writeText(message);
          showToast(t('home.linkCopied'));
          return;
        }

        Alert.alert('Share', message);
        return;
      }

      await Share.share(
        {
          title: video.title,
          message,
          url: video.playbackUrl,
        },
        {
          dialogTitle: video.title,
        }
      );
    } catch {
      Alert.alert(t('home.shareUnavailable'), t('home.shareUnavailableHint'));
    }
  }, [showToast, t]);

  const renderItem: ListRenderItem<Video> = useCallback(
    ({ item }) => {
      const interaction = getInteraction(item.id);
      const series = getSeriesById(videos, item.seriesId);
      const nextEpisode = series ? getNextEpisode(series, item.episodeNumber) : undefined;
      const firstFreeEpisodeInSeries = series?.episodes.find(
        (episode) => episode.accessType === 'free' && episode.isAvailable
      );
      const progress = getProgress(item.seriesId);
      const resumePositionSeconds =
        progress?.lastWatchedVideoId === item.id ? progress.positionSeconds : 0;

      return (
        <DramaFeedItem
          video={item}
          height={pageExtent}
          isActive={item.id === resolvedActiveVideoId}
          isScreenFocused={isScreenFocused}
          isLiked={interaction.isLiked}
          isSaved={interaction.isSaved}
          isMuted={isMuted}
          likeCount={getLikeCount(item)}
          nextEpisode={nextEpisode}
          firstFreeEpisodeInSeries={firstFreeEpisodeInSeries}
          resumePositionSeconds={resumePositionSeconds}
          isClearDisplay={isClearDisplay}
          onToggleClearDisplay={setClearDisplay}
          onShare={() => {
            void handleShare(item);
          }}
          onToggleLike={() => {
            toggleLike(item.id);
            trackEvent('video_like', { videoId: item.id, value: !interaction.isLiked });
          }}
          onToggleSave={() => {
            toggleSave(item.id);
            trackEvent('video_save', { videoId: item.id, value: !interaction.isSaved });
            showToast(interaction.isSaved ? t('home.removedFromSaved') : t('home.addedToSaved'));
          }}
          onToggleMute={() => {
            setIsMuted((current) => !current);
          }}
          onRecordProgress={(positionSeconds, durationSeconds) => {
            recordProgress(
              item.seriesId,
              item.id,
              item.episodeNumber,
              positionSeconds,
              durationSeconds
            );
          }}
        />
      );
    },
    [
      videos,
      resolvedActiveVideoId,
      isScreenFocused,
      pageExtent,
      isClearDisplay,
      setClearDisplay,
      t,
      getInteraction,
      getLikeCount,
      getProgress,
      recordProgress,
      handleShare,
      toggleLike,
      toggleSave,
      showToast,
      isMuted,
    ]
  );

  if (isLoading && videos.length === 0) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <ActivityIndicator color={Palette.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <Text style={styles.stateTitle}>{t('home.loadError')}</Text>
        {__DEV__ ? <Text style={styles.stateDetail}>{error.message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={refresh}
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (videos.length === 0) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <Text style={styles.stateTitle}>{t('home.empty')}</Text>
      </View>
    );
  }

  return (
    <View onLayout={handleLayout} style={styles.container} testID="feed-viewport">
      <FlatList
        ref={flatListRef}
        testID="feed-list"
        data={videos}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        // Cells are memoised, so both pieces of state that change how an item
        // renders have to be declared here or clear display would only take
        // effect on the next re-mount.
        extraData={`${resolvedActiveVideoId}:${isClearDisplay}`}
        pagingEnabled
        snapToAlignment="start"
        snapToInterval={pageExtent}
        decelerationRate="fast"
        // Issue 2: the platform-level guard against a fast fling's momentum
        // carrying the scroll view past the next snap interval. Necessary,
        // but - see `useFeedPagingGuard` - not sufficient on its own, which
        // is why `onScrollBeginDrag`/`onMomentumScrollEnd` below add a
        // deterministic correction on top of it.
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        // BOUNDS HOW MANY NATIVE VIDEO PLAYERS EXIST AT ONCE.
        //
        // Every rendered cell is a `DramaFeedItem`, and every DramaFeedItem
        // owns an `expo-video` player - a real native decoder and its buffers,
        // not a cheap view. FlatList's default `windowSize` is 21 (ten
        // viewports either side of the visible one), so a viewer who had
        // scrolled a little way into the feed could be holding around twenty
        // of them. That is invisible on a development handset and is exactly
        // the shape of failure a 2 GB device meets first: memory pressure, then
        // decoder exhaustion, then a black frame or a kill.
        //
        // 3 keeps the previous and next page mounted, which is what makes a
        // swipe feel instant and gives the next item a chance to prepare - the
        // reason for not simply using 1. `getItemLayout` above means a jump to
        // an arbitrary index (Series Detail -> a specific episode) still works
        // exactly as before, because FlatList can compute the offset without
        // having rendered the rows in between.
        //
        // `initialNumToRender` is deliberately LEFT at its default. Lowering it
        // to 1 is the usual companion to this and does bound the cold-start
        // burst too, but it also stops the episode-navigation and guest-entry
        // suites from mounting the rows they assert on - and those are the only
        // automated proof that a Series Detail tap lands on the right episode.
        // Trading that proof for a smaller first batch is a bad deal: the
        // steady-state window is what actually grows without bound as somebody
        // scrolls a long feed, and that is what `windowSize` fixes.
        //
        // `removeClippedSubviews` is deliberately NOT set: on Android it is a
        // known source of blank cells with complex children, and there is no
        // device here to prove it safe.
        windowSize={3}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={handleViewableItemsChanged}
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        getItemLayout={(_data, index) => ({
          length: pageExtent,
          offset: pageExtent * index,
          index,
        })}
      />
      <View
        pointerEvents="none"
        style={[
          styles.brandOverlay,
          { top: insets.top + BRAND_OVERLAY_TOP_OFFSET },
          isClearDisplay && styles.brandOverlayHidden,
        ]}>
        <Text maxFontSizeMultiplier={BRAND_OVERLAY_MAX_FONT_SCALE} style={styles.brandOverlayText}>
          Red Panda
        </Text>
        <View style={styles.brandOverlayDot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  stateTitle: {
    fontSize: 17,
    fontFamily: FontFamily.bold,
    color: Palette.text,
    textAlign: 'center',
  },
  stateDetail: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Palette.primary,
  },
  retryButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  brandOverlayHidden: {
    opacity: 0,
  },
  brandOverlay: {
    position: 'absolute',
    left: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  brandOverlayText: {
    // UI polish (2026-08-22): the brand mark used to be 16/extraBold - a
    // second heavyweight line stacked directly above an 18/extraBold title,
    // so the upper-left read as one oversized text block competing with the
    // video. Dropping it to `Typography.body` (14/regular) keeps the wordmark
    // legible over moving footage (the shadow below does that work) while
    // making the TITLE unambiguously the strongest text on screen. Taken from
    // the shared token rather than a new literal, so the brand line and every
    // other body-sized string move together.
    ...Typography.body,
    color: Palette.text,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  brandOverlayDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Palette.brandRed,
  },
});
