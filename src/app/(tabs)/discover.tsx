import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { mockDramaVideos } from '@/data/mock-drama-videos';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { Video, VideoCategory } from '@/types/video';

type CategoryFilter = 'All' | VideoCategory;

const categoryFilters: readonly CategoryFilter[] = [
  'All',
  'Romance',
  'Revenge',
  'Family',
  'CEO',
  'Historical',
];

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function formatLikeCount(likeCount: number) {
  if (likeCount >= 1000) {
    return `${(likeCount / 1000).toFixed(1)}K`;
  }

  return `${likeCount}`;
}

function videoMatchesSearch(video: Video, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const searchableValues = [
    video.title,
    video.caption,
    video.channelName,
    video.indonesianSubtitlePreview,
    video.category,
  ];

  return searchableValues.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export default function DiscoverScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('All');
  const { getLikeCount } = useVideoInteractions();

  const filteredVideos = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(searchQuery);

    return mockDramaVideos.filter((video) => {
      const matchesCategory = selectedCategory === 'All' || video.category === selectedCategory;
      const matchesSearch = videoMatchesSearch(video, normalizedQuery);

      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Discover</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={setSearchQuery}
        placeholder="Search dramas, channels, subtitles..."
        placeholderTextColor="#9ca3af"
        style={styles.searchInput}
        value={searchQuery}
      />

      <ScrollView
        horizontal
        contentContainerStyle={styles.categoryList}
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
        {video.indonesianSubtitlePreview || video.caption}
      </Text>
      <Text style={styles.likes}>{formatLikeCount(likeCount)} likes</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  searchInput: {
    marginTop: 20,
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
    gap: 8,
    paddingTop: 16,
    paddingBottom: 16,
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
    gap: 12,
    paddingBottom: 24,
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
