import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import {
  getCategories,
  searchVideos,
  type VideoCategoryFilter,
} from '@/services/videos/video-service';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

const categoryFilters = getCategories();

export default function DiscoverScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<VideoCategoryFilter>('All');
  const { getLikeCount } = useVideoInteractions();
  const { videos, isLoading, error, refresh } = useVideoCatalog();

  const filteredVideos = useMemo(() => {
    return searchVideos(videos, searchQuery, selectedCategory);
  }, [videos, searchQuery, selectedCategory]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Discover</Text>
      <View style={styles.searchBar}>
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={18}
          tintColor={Palette.textMuted}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearchQuery}
          placeholder="Cari judul drama…"
          placeholderTextColor={Palette.textMuted}
          style={styles.searchInput}
          value={searchQuery}
        />
        {searchQuery.length > 0 ? (
          <Pressable
            accessibilityLabel="Hapus pencarian"
            accessibilityRole="button"
            onPress={() => setSearchQuery('')}
            style={styles.clearButton}>
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={12}
              tintColor={Palette.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

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
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={Palette.primary} size="large" />
            </View>
          ) : error ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Video gagal dimuat.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={refresh}
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <SymbolView
                  name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                  size={26}
                  tintColor={Palette.textMuted}
                />
              </View>
              <Text style={styles.emptyTitle}>Tidak ada hasil</Text>
              <Text style={styles.emptyDescription}>
                Coba kata kunci lain atau pilih kategori yang berbeda.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                }}
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
                <Text style={styles.retryButtonText}>Reset pencarian</Text>
              </Pressable>
            </View>
          )
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

export function DiscoverResultCard({ video, likeCount: _likeCount }: DiscoverResultCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/series/[id]', params: { id: video.seriesId } })}
      style={({ pressed }) => [styles.resultCard, pressed && styles.buttonPressed]}>
      <View style={styles.thumbnail}>
        <Image contentFit="cover" source={{ uri: video.thumbnailUrl }} style={styles.thumbnailImage} />
        <Text style={styles.thumbnailBadge}>EP {video.episodeNumber}</Text>
      </View>
      <View style={styles.resultBody}>
        <Text numberOfLines={2} style={styles.resultTitle}>
          {video.title}
        </Text>
        <View style={styles.resultMetaRow}>
          <Text style={styles.episodeBadge}>EP {video.episodeNumber}</Text>
          <Text style={styles.categoryPill}>{video.category}</Text>
        </View>
        <Text style={styles.channel}>{video.channelName}</Text>
        <Text numberOfLines={2} style={styles.preview}>
          {video.caption}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 70,
    backgroundColor: Palette.background,
  },
  title: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  searchBar: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: FontFamily.regular,
    color: Palette.text,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryList: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingRight: 40,
  },
  categoryScroller: {
    flexGrow: 0,
    minHeight: 50,
    marginTop: 14,
    marginBottom: 6,
  },
  categoryChip: {
    height: 38,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
  },
  categoryChipSelected: {
    borderColor: Palette.primary,
    backgroundColor: Palette.primary,
  },
  categoryText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  categoryTextSelected: {
    color: Palette.text,
  },
  resultList: {
    gap: 12,
    paddingTop: 2,
    paddingBottom: 120,
  },
  resultCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  thumbnail: {
    width: 78,
    height: 104,
    borderRadius: Radius.md,
    backgroundColor: Palette.backgroundElevated,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    fontSize: 9,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
    backgroundColor: 'rgba(13, 13, 15, 0.75)',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  resultBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 5,
  },
  resultTitle: {
    fontSize: 14.5,
    lineHeight: 19,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  resultMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  episodeBadge: {
    fontSize: 10,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
    backgroundColor: 'rgba(255, 122, 26, 0.14)',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    overflow: 'hidden',
  },
  categoryPill: {
    fontSize: 10.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  channel: {
    fontSize: 11,
    fontFamily: FontFamily.bold,
    color: Palette.textMuted,
  },
  preview: {
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 56,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  emptyDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
    maxWidth: 240,
  },
  retryButton: {
    marginTop: 6,
    height: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  retryButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  buttonPressed: {
    opacity: 0.72,
  },
});
