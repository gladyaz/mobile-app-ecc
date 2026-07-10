import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatLikeCount } from '@/components/drama-feed-item';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

export default function SavedScreen() {
  const { getLikeCount, savedVideos, toggleSave } = useVideoInteractions();

  if (savedVideos.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.title}>Saved</Text>
        <Text style={styles.description}>Your saved dramas will appear here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Saved</Text>
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
    padding: 24,
    backgroundColor: '#fff',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
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
  listContent: {
    gap: 12,
    paddingTop: 20,
    paddingBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
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
