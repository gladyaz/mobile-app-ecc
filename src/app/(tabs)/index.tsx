import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  LayoutChangeEvent,
  ListRenderItem,
  Platform,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewToken,
  ViewabilityConfig,
} from 'react-native';

import { DramaFeedItem } from '@/components/drama-feed-item';
import { useVideoFeed } from '@/features/feed/hooks/use-video-feed';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

type WebShareNavigator = {
  readonly clipboard?: {
    readonly writeText: (text: string) => Promise<void>;
  };
  readonly share?: (data: { readonly title?: string; readonly text?: string; readonly url?: string }) => Promise<void>;
};

export default function HomeScreen() {
  const { height } = useWindowDimensions();
  const videos = useVideoFeed();
  const { getInteraction, getLikeCount, toggleLike, toggleSave } = useVideoInteractions();
  const [feedHeight, setFeedHeight] = useState(height);
  const [activeVideoId, setActiveVideoId] = useState(videos[0]?.id);
  const viewabilityConfig = useRef<ViewabilityConfig>({
    itemVisiblePercentThreshold: 80,
  });
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Video>[] }) => {
      const activeItem = viewableItems.find((viewableItem) => viewableItem.isViewable);

      if (activeItem?.item) {
        setActiveVideoId(activeItem.item.id);
      }
    }
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

      return (
        <DramaFeedItem
          video={item}
          height={feedHeight}
          isActive={item.id === activeVideoId}
          isLiked={interaction.isLiked}
          isSaved={interaction.isSaved}
          likeCount={getLikeCount(item)}
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
    [activeVideoId, feedHeight, getInteraction, getLikeCount, handleShare, toggleLike, toggleSave]
  );

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={activeVideoId}
        pagingEnabled
        snapToAlignment="start"
        snapToInterval={feedHeight}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        viewabilityConfig={viewabilityConfig.current}
        onViewableItemsChanged={onViewableItemsChanged.current}
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
});
