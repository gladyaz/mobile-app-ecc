import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SubtitleOverlay } from '@/components/subtitle-overlay';
import type { Video } from '@/types/video';

type DramaFeedItemProps = {
  readonly video: Video;
  readonly height: number;
  readonly isActive: boolean;
  readonly isLiked: boolean;
  readonly isSaved: boolean;
  readonly likeCount: number;
  readonly onShare: () => void;
  readonly onToggleLike: () => void;
  readonly onToggleSave: () => void;
};

export function formatLikeCount(likeCount: number) {
  if (likeCount >= 1000) {
    return `${(likeCount / 1000).toFixed(1)}K`;
  }

  return `${likeCount}`;
}

export function DramaFeedItem({
  video,
  height,
  isActive,
  isLiked,
  isSaved,
  likeCount,
  onShare,
  onToggleLike,
  onToggleSave,
}: DramaFeedItemProps) {
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const player = useVideoPlayer(video.videoUrl, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.muted = true;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  useEffect(() => {
    if (isActive && !isManuallyPaused) {
      player.play();
      return;
    }

    player.pause();
  }, [isActive, isManuallyPaused, player]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      player.pause();
      setIsManuallyPaused(true);
      return;
    }

    player.play();
    setIsManuallyPaused(false);
  }, [isPlaying, player]);

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.videoLayer}>
        <VideoView
          contentFit="cover"
          nativeControls={false}
          player={player}
          playsInline
          style={styles.video}
        />
        <SubtitleOverlay subtitles={video.indonesianSubtitles} />
      </View>
      <View pointerEvents="none" style={styles.bottomScrim} />

      <Pressable
        accessibilityRole="button"
        onPress={handlePlayPause}
        style={({ pressed }) => [styles.playPauseButton, pressed && styles.buttonPressed]}>
        <Text style={styles.playPauseText}>{isPlaying ? 'Pause' : 'Play'}</Text>
      </Pressable>

      <View style={styles.content}>
        <View style={styles.details}>
          <View style={styles.metaRow}>
            <Text style={styles.episode}>Episode {video.episodeNumber}</Text>
            <Text style={styles.channel}>{video.channelName}</Text>
          </View>
          <Text style={styles.title}>{video.title}</Text>
          <Text style={styles.caption}>{video.caption}</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleLike}
            style={({ pressed }) => [
              styles.actionButton,
              isLiked && styles.actionButtonActive,
              pressed && styles.buttonPressed,
            ]}>
            <Text style={styles.actionLabel}>{isLiked ? 'Liked' : 'Like'}</Text>
            <Text style={styles.actionValue}>{formatLikeCount(likeCount)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleSave}
            style={({ pressed }) => [
              styles.actionButton,
              isSaved && styles.actionButtonActive,
              pressed && styles.buttonPressed,
            ]}>
            <Text style={styles.actionLabel}>{isSaved ? 'Saved' : 'Save'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onShare}
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
  videoLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  video: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  bottomScrim: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 260,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  playPauseButton: {
    position: 'absolute',
    top: 54,
    right: 18,
    minWidth: 82,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  playPauseText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  content: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 18,
    paddingHorizontal: 18,
    paddingBottom: 28,
  },
  details: {
    flex: 1,
    paddingRight: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  episode: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fecdd3',
  },
  title: {
    marginTop: 8,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#fff',
  },
  channel: {
    fontSize: 14,
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
    gap: 12,
  },
  actionButton: {
    minWidth: 66,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionButtonActive: {
    backgroundColor: 'rgba(209, 31, 63, 0.72)',
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
