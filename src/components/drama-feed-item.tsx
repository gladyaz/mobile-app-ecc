import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Video } from '@/types/video';

type DramaFeedItemProps = {
  readonly video: Video;
  readonly height: number;
};

function formatLikeCount(likeCount: number) {
  if (likeCount >= 1000) {
    return `${(likeCount / 1000).toFixed(1)}K`;
  }

  return `${likeCount}`;
}

export function DramaFeedItem({ video, height }: DramaFeedItemProps) {
  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.videoPlaceholder}>
        <View style={styles.placeholderGlow} />
        <Text style={styles.placeholderText}>Video Placeholder</Text>
        <View style={styles.subtitleBox}>
          <Text style={styles.mandarinSubtitle}>{video.mandarinSubtitlePreview}</Text>
          <Text style={styles.indonesianSubtitle}>{video.indonesianSubtitlePreview}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.details}>
          <Text style={styles.episode}>Episode {video.episodeNumber}</Text>
          <Text style={styles.title}>{video.title}</Text>
          <Text style={styles.channel}>{video.channelName}</Text>
          <Text style={styles.caption}>{video.caption}</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
            <Text style={styles.actionLabel}>Like</Text>
            <Text style={styles.actionValue}>{formatLikeCount(video.likeCount)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
            <Text style={styles.actionLabel}>{video.isSaved ? 'Saved' : 'Save'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
            <Text style={styles.actionLabel}>Share</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    backgroundColor: '#111827',
  },
  videoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#1f2937',
  },
  placeholderGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#d11f3f',
    opacity: 0.22,
  },
  placeholderText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f9fafb',
  },
  subtitleBox: {
    position: 'absolute',
    right: 24,
    bottom: 132,
    left: 24,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  mandarinSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#e5e7eb',
    textAlign: 'center',
  },
  indonesianSubtitle: {
    marginTop: 4,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  content: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  details: {
    flex: 1,
  },
  episode: {
    marginBottom: 6,
    fontSize: 14,
    fontWeight: '700',
    color: '#fecdd3',
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#fff',
  },
  channel: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: '#f3f4f6',
  },
  caption: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: '#d1d5db',
  },
  actions: {
    alignItems: 'center',
    gap: 10,
  },
  actionButton: {
    minWidth: 58,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  actionValue: {
    marginTop: 2,
    fontSize: 12,
    color: '#e5e7eb',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
