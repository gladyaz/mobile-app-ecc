import { useCallback, useState } from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  ListRenderItem,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { DramaFeedItem } from '@/components/drama-feed-item';
import { mockDramaVideos } from '@/data/mock-drama-videos';
import type { Video } from '@/types/video';

export default function HomeScreen() {
  const { height } = useWindowDimensions();
  const [feedHeight, setFeedHeight] = useState(height);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;

    setFeedHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  }, []);

  const renderItem: ListRenderItem<Video> = useCallback(
    ({ item }) => <DramaFeedItem video={item} height={feedHeight} />,
    [feedHeight]
  );

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <FlatList
        data={mockDramaVideos}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        pagingEnabled
        snapToAlignment="start"
        snapToInterval={feedHeight}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
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
