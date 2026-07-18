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
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import { getNextEpisode, getSeriesById } from '@/services/videos/series-service';
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
  const [feedHeight, setFeedHeight] = useState(height);
  const [activeVideoId, setActiveVideoId] = useState<string | undefined>(undefined);
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

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Video>[] }) => {
      const activeItem = viewableItems.find((viewableItem) => viewableItem.isViewable);

      if (activeItem?.item) {
        setActiveVideoId(activeItem.item.id);
      }
    },
    []
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
          Alert.alert('Share ready', 'Drama link copied to clipboard.');
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
  }, []);

  const renderItem: ListRenderItem<Video> = useCallback(
    ({ item }) => {
      const interaction = getInteraction(item.id);
      const series = getSeriesById(videos, item.seriesId);
      const nextEpisode = series ? getNextEpisode(series, item.episodeNumber) : undefined;
      const firstFreeEpisodeInSeries = series?.episodes.find(
        (episode) => episode.accessType === 'free' && episode.isAvailable
      );

      return (
        <DramaFeedItem
          video={item}
          height={feedHeight}
          isActive={item.id === resolvedActiveVideoId}
          isScreenFocused={isScreenFocused}
          isLiked={interaction.isLiked}
          isSaved={interaction.isSaved}
          likeCount={getLikeCount(item)}
          nextEpisode={nextEpisode}
          firstFreeEpisodeInSeries={firstFreeEpisodeInSeries}
          onShare={() => {
            void handleShare(item);
          }}
          onToggleLike={() => {
            toggleLike(item.id);
          }}
          onToggleSave={() => {
            toggleSave(item.id);
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
      handleShare,
      toggleLike,
      toggleSave,
    ]
  );

  if (isLoading && videos.length === 0) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <ActivityIndicator color="#fff" size="large" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  stateDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: '#9ca3af',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#d11f3f',
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
