import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatLikeCount } from '@/components/drama-feed-item';
import { getSavedVideos } from '@/services/videos/video-service';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

export default function SavedScreen() {
  const { getLikeCount, savedVideoIds, toggleSave } = useVideoInteractions();
  const savedVideos = useMemo(() => getSavedVideos(savedVideoIds), [savedVideoIds]);

  if (savedVideos.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.title}>Saved</Text>
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>No saved dramas yet</Text>
          <Text style={styles.description}>
            Save a drama from the feed and it will appear here for quick access.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Saved</Text>
      <Text style={styles.description}>Your saved Mandarin short dramas.</Text>
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

function SavedVideoCard({ video, likeCount, onUnsave }: SavedVideoCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <Text style={styles.episode}>Episode {video.episodeNumber}</Text>
        <Text style={styles.cardTitle}>{video.title}</Text>
        <Text style={styles.channel}>{video.channelName}</Text>
        <Text numberOfLines={2} style={styles.subtitle}>
          {video.indonesianSubtitles[0]?.text ?? video.indonesianSubtitlePreview}
        </Text>
        <Text style={styles.likes}>{formatLikeCount(likeCount)} likes</Text>
      </View>
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
    paddingHorizontal: 20,
    paddingTop: 24,
    backgroundColor: '#fff',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  description: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 24,
    color: '#4b5563',
  },
  emptyPanel: {
    marginTop: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  listContent: {
    gap: 14,
    paddingTop: 18,
    paddingBottom: 96,
  },
  card: {
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  cardContent: {
    flex: 1,
  },
  episode: {
    fontSize: 13,
    fontWeight: '700',
    color: '#d11f3f',
  },
  cardTitle: {
    marginTop: 4,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: '#111827',
  },
  channel: {
    marginTop: 4,
    fontSize: 14,
    color: '#4b5563',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: '#374151',
  },
  likes: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  unsaveButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#111827',
  },
  unsaveButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
