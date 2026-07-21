import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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

import { DramaFeedItem } from '@/components/drama-feed-item';
import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import { getNextEpisode, getSeriesById } from '@/services/videos/series-service';
import { useSeriesProgress } from '@/stores/series-progress';
import { useToast } from '@/stores/toast';
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

export default function HomeScreen() {
  const { height } = useWindowDimensions();
  const isScreenFocused = useIsFocused();
  const { videoId: requestedVideoId } = useLocalSearchParams<{ videoId?: string }>();
  const { videos, isLoading, error, refresh } = useVideoCatalog();
  const { getInteraction, getLikeCount, toggleLike, toggleSave } = useVideoInteractions();
  const { getProgress, recordProgress } = useSeriesProgress();
  const { showToast } = useToast();
  const [feedHeight, setFeedHeight] = useState(height);
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
  const flatListRef = useRef<FlatList<Video>>(null);
  const handledRequestedVideoIdRef = useRef<string | undefined>(undefined);

  // A Series Detail episode selection returns here with ?videoId=... so the
  // selected episode plays in the existing feed player instead of a second,
  // duplicate player screen. resolvedActiveVideoId already reflects the
  // requested episode above; this effect only performs the imperative scroll.
  useEffect(() => {
    if (
      !requestedVideoId ||
      !requestedVideoIsInCatalog ||
      handledRequestedVideoIdRef.current === requestedVideoId
    ) {
      return;
    }

    const targetIndex = videos.findIndex((video) => video.id === requestedVideoId);

    handledRequestedVideoIdRef.current = requestedVideoId;
    flatListRef.current?.scrollToIndex({ index: targetIndex, animated: true });
  }, [requestedVideoId, requestedVideoIsInCatalog, videos]);

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

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Video>[] }) => {
      const activeItem = viewableItems.find((viewableItem) => viewableItem.isViewable);

      if (!activeItem?.item) {
        return;
      }

      setActiveVideoId(activeItem.item.id);

      // A video becoming viewable (e.g. on mount, or a scroll past it) only
      // confirms it as the last-watched item - it must not reset an
      // already-tracked playback position back to 0, or a resumed position
      // would be clobbered moments after being restored from storage.
      const existingProgress = getProgressRef.current(activeItem.item.seriesId);
      const isSameVideo = existingProgress?.lastWatchedVideoId === activeItem.item.id;

      recordProgress(
        activeItem.item.seriesId,
        activeItem.item.id,
        activeItem.item.episodeNumber,
        isSameVideo ? existingProgress.positionSeconds : 0,
        isSameVideo ? existingProgress.durationSeconds : undefined
      );
    },
    [recordProgress]
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;

    setFeedHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  }, []);

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
          showToast('Link video disalin');
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
      Alert.alert('Share unavailable', 'Please try again later.');
    }
  }, [showToast]);

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
          height={feedHeight}
          isActive={item.id === resolvedActiveVideoId}
          isScreenFocused={isScreenFocused}
          isLiked={interaction.isLiked}
          isSaved={interaction.isSaved}
          isMuted={isMuted}
          likeCount={getLikeCount(item)}
          nextEpisode={nextEpisode}
          firstFreeEpisodeInSeries={firstFreeEpisodeInSeries}
          resumePositionSeconds={resumePositionSeconds}
          onShare={() => {
            void handleShare(item);
          }}
          onToggleLike={() => {
            toggleLike(item.id);
          }}
          onToggleSave={() => {
            toggleSave(item.id);
            showToast(interaction.isSaved ? 'Dihapus dari Saved' : 'Disimpan ke Saved');
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
      feedHeight,
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
        <Text style={styles.stateTitle}>Video gagal dimuat.</Text>
        {__DEV__ ? <Text style={styles.stateDetail}>{error.message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={refresh}
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (videos.length === 0) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <Text style={styles.stateTitle}>Belum ada video tersedia.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <FlatList
        ref={flatListRef}
        data={videos}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={resolvedActiveVideoId}
        pagingEnabled
        snapToAlignment="start"
        snapToInterval={feedHeight}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={handleViewableItemsChanged}
        onScrollToIndexFailed={({ index }) => {
          flatListRef.current?.scrollToOffset({ offset: feedHeight * index, animated: false });
        }}
        getItemLayout={(_data, index) => ({
          length: feedHeight,
          offset: feedHeight * index,
          index,
        })}
      />
      <View pointerEvents="none" style={styles.brandOverlay}>
        <Text style={styles.brandOverlayText}>Red Panda</Text>
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
  brandOverlay: {
    position: 'absolute',
    top: 64,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  brandOverlayText: {
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
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
