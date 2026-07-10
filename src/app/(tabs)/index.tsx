import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  ListRenderItem,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewToken,
  ViewabilityConfig,
} from 'react-native';

import { DramaFeedItem } from '@/components/drama-feed-item';
import { mockDramaVideos } from '@/data/mock-drama-videos';
import type { Video } from '@/types/video';

export default function HomeScreen() {
  const { height } = useWindowDimensions();
  const [feedHeight, setFeedHeight] = useState(height);
  const [activeVideoId, setActiveVideoId] = useState(mockDramaVideos[0]?.id);
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

  const renderItem: ListRenderItem<Video> = useCallback(
    ({ item }) => (
      <DramaFeedItem video={item} height={feedHeight} isActive={item.id === activeVideoId} />
    ),
    [activeVideoId, feedHeight]
  );

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <FlatList
        data={mockDramaVideos}
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
