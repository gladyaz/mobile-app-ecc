import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import { getSavedVideos } from '@/services/videos/video-service';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

export default function SavedScreen() {
  const { getLikeCount, savedVideoIds, toggleSave } = useVideoInteractions();
  const { videos } = useVideoCatalog();
  const savedVideos = useMemo(
    () => getSavedVideos(videos, savedVideoIds),
    [videos, savedVideoIds]
  );

  if (savedVideos.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.title}>Saved</Text>
        <View style={styles.emptyState}>
          <View style={styles.emptyIconCircle}>
            <SymbolView
              name={{ ios: 'bookmark', android: 'bookmark_border', web: 'bookmark_border' }}
              size={26}
              tintColor={Palette.textMuted}
            />
          </View>
          <Text style={styles.emptyTitle}>Belum ada video tersimpan</Text>
          <Text style={styles.description}>
            Simpan drama favoritmu dari Home agar mudah ditonton lagi.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/')}
            style={({ pressed }) => [styles.exploreButton, pressed && styles.buttonPressed]}>
            <Text style={styles.exploreButtonText}>Jelajahi Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Saved</Text>
        <Text style={styles.savedCount}>{savedVideos.length} video</Text>
      </View>
      <FlatList
        data={savedVideos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <SavedVideoCard
            video={item}
            likeCount={getLikeCount(item)}
            onUnsave={() => {
              toggleSave(item.id);
            }}
          />
        )}
      />
    </View>
  );
}

type SavedVideoCardProps = {
  readonly video: Video;
  readonly likeCount: number;
  readonly onUnsave: () => void;
};

export function SavedVideoCard({ video, likeCount: _likeCount, onUnsave }: SavedVideoCardProps) {
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/series/[id]', params: { id: video.seriesId } })}
        style={styles.thumbnail}>
        <Image contentFit="cover" source={{ uri: video.thumbnailUrl }} style={styles.thumbnailImage} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/series/[id]', params: { id: video.seriesId } })}
        style={({ pressed }) => [styles.cardContent, pressed && styles.buttonPressed]}>
        <Text numberOfLines={2} style={styles.cardTitle}>
          {video.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.episodeBadge}>EP {video.episodeNumber}</Text>
          <Text style={styles.categoryPill}>{video.category}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onUnsave}
        style={({ pressed }) => [styles.unsaveButton, pressed && styles.buttonPressed]}>
        <Text style={styles.unsaveButtonText}>Unsave</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 70,
    backgroundColor: Palette.background,
  },
  emptyContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 70,
    backgroundColor: Palette.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  title: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  savedCount: {
    fontSize: 12.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textMuted,
  },
  description: {
    fontSize: 13,
    lineHeight: 21,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
    maxWidth: 230,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: 96,
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
    marginTop: 4,
  },
  exploreButton: {
    marginTop: 6,
    height: 46,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: Palette.primary,
  },
  exploreButtonText: {
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  listContent: {
    gap: 12,
    paddingTop: 14,
    paddingBottom: 110,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  thumbnail: {
    width: 62,
    height: 84,
    borderRadius: Radius.md,
    backgroundColor: Palette.backgroundElevated,
    overflow: 'hidden',
    flexShrink: 0,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  metaRow: {
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
  unsaveButton: {
    flexShrink: 0,
    height: 40,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  unsaveButtonText: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
