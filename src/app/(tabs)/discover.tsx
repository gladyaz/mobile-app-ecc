import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  getCategories,
  searchVideos,
  type VideoCategoryFilter,
} from '@/services/videos/video-service';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

const categoryFilters = getCategories();

function formatLikeCount(likeCount: number) {
  if (likeCount >= 1000) {
    return `${(likeCount / 1000).toFixed(1)}K`;
  }

  return `${likeCount}`;
}

export default function DiscoverScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<VideoCategoryFilter>('All');
  const { getLikeCount } = useVideoInteractions();

  const filteredVideos = useMemo(() => {
    return searchVideos(searchQuery, selectedCategory);
  }, [searchQuery, selectedCategory]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Discover</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={setSearchQuery}
        placeholder="Search dramas, channels, categories..."
        placeholderTextColor="#9ca3af"
        style={styles.searchInput}
        value={searchQuery}
      />

      <ScrollView
        horizontal
        contentContainerStyle={styles.categoryList}
        style={styles.categoryScroller}
        showsHorizontalScrollIndicator={false}>
        {categoryFilters.map((category) => {
          const isSelected = selectedCategory === category;

          return (
            <Pressable
              accessibilityRole="button"
              key={category}
              onPress={() => {
                setSelectedCategory(category);
              }}
              style={({ pressed }) => [
                styles.categoryChip,
                isSelected && styles.categoryChipSelected,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={[styles.categoryText, isSelected && styles.categoryTextSelected]}>
                {category}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={filteredVideos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.resultList}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No dramas found</Text>
            <Text style={styles.emptyDescription}>Try another keyword or category.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <DiscoverResultCard video={item} likeCount={getLikeCount(item)} />
        )}
      />
    </View>
  );
}

type DiscoverResultCardProps = {
  readonly video: Video;
  readonly likeCount: number;
};

function DiscoverResultCard({ video, likeCount }: DiscoverResultCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.resultCard, pressed && styles.buttonPressed]}>
      <View style={styles.resultMetaRow}>
        <Text style={styles.episode}>Episode {video.episodeNumber}</Text>
        <Text style={styles.categoryPill}>{video.category}</Text>
      </View>
      <Text style={styles.resultTitle}>{video.title}</Text>
      <Text style={styles.channel}>{video.channelName}</Text>
      <Text numberOfLines={2} style={styles.preview}>
        {video.caption}
      </Text>
      <Text style={styles.likes}>{formatLikeCount(likeCount)} likes</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  searchInput: {
    marginTop: 18,
    marginBottom: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#fff',
  },
  categoryList: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingRight: 40,
  },
  categoryScroller: {
    flexGrow: 0,
    minHeight: 48,
    marginBottom: 20,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  categoryChipSelected: {
    borderColor: '#d11f3f',
    backgroundColor: '#d11f3f',
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4b5563',
  },
  categoryTextSelected: {
    color: '#fff',
  },
  resultList: {
    gap: 14,
    paddingBottom: 120,
  },
  resultCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  resultMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  episode: {
    fontSize: 13,
    fontWeight: '700',
    color: '#d11f3f',
  },
  categoryPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '700',
    color: '#d11f3f',
    backgroundColor: '#ffe4e6',
  },
  resultTitle: {
    marginTop: 8,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '800',
    color: '#111827',
  },
  channel: {
    marginTop: 4,
    fontSize: 14,
    color: '#4b5563',
  },
  preview: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
  },
  likes: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  emptyDescription: {
    marginTop: 8,
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.72,
  },
});
