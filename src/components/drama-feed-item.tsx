import { useEvent } from 'expo';
import { router } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PremiumPreviewModal } from '@/components/premium-preview-modal';
import type { Episode } from '@/types/series';
import type { Video } from '@/types/video';

// Embedded (burned-in) Indonesian subtitles typically sit in the bottom
// ~10-15% of the frame. Reserve a proportional safe zone (rather than a
// fixed pixel value) so it scales across device heights. `height` here is
// the feed item's own rendered height, which Home already measures as the
// tab screen's content area (excluding the bottom tab bar) - see
// (tabs)/index.tsx's onLayout handler.
const SUBTITLE_SAFE_ZONE_RATIO = 0.16;

type DramaFeedItemProps = {
  readonly video: Video;
  readonly height: number;
  readonly isActive: boolean;
  readonly isScreenFocused: boolean;
  readonly isLiked: boolean;
  readonly isSaved: boolean;
  readonly likeCount: number;
  readonly nextEpisode?: Episode;
  readonly firstFreeEpisodeInSeries?: Episode;
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
  isScreenFocused,
  isLiked,
  isSaved,
  likeCount,
  nextEpisode,
  firstFreeEpisodeInSeries,
  onShare,
  onToggleLike,
  onToggleSave,
}: DramaFeedItemProps) {
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const [isInFullscreen, setIsInFullscreen] = useState(false);
  const [isPremiumModalVisible, setIsPremiumModalVisible] = useState(false);
  const [isIndicatorVisible, setIsIndicatorVisible] = useState(true);
  const hasPlaybackUrl = video.playbackUrl.length > 0;
  const videoViewRef = useRef<VideoView>(null);
  const isInFullscreenRef = useRef(false);
  const player = useVideoPlayer(hasPlaybackUrl ? video.playbackUrl : null, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.muted = true;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status, error } = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: null });
  const hasPlaybackError = !hasPlaybackUrl || status === 'error';
  const hasLoggedErrorRef = useRef(false);

  // Prefer backend-provided dimensions (instant); fall back to the actual
  // decoded video track once it loads; default to false (no fullscreen
  // button) when orientation genuinely cannot be determined.
  const metadataIsHorizontal =
    video.width != null && video.height != null ? video.width > video.height : undefined;
  const runtimeIsHorizontal =
    videoTrack?.size != null ? videoTrack.size.width > videoTrack.size.height : undefined;
  const isHorizontal = metadataIsHorizontal ?? runtimeIsHorizontal ?? false;
  const subtitleSafeZoneHeight = Math.round(height * SUBTITLE_SAFE_ZONE_RATIO);

  useEffect(() => {
    isInFullscreenRef.current = isInFullscreen;
  }, [isInFullscreen]);

  useEffect(() => {
    const videoView = videoViewRef.current;

    return () => {
      if (isInFullscreenRef.current) {
        void videoView?.exitFullscreen();
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasPlaybackError) {
      hasLoggedErrorRef.current = false;
      return;
    }

    if (!__DEV__ || hasLoggedErrorRef.current) {
      return;
    }

    hasLoggedErrorRef.current = true;
    console.warn(
      `[DramaFeedItem] Unable to play "${video.title}". playbackUrl=${
        video.playbackUrl || '(empty)'
      }${error ? ` error=${error.message}` : ''}`
    );
  }, [error, hasPlaybackError, video.playbackUrl, video.title]);

  useEffect(() => {
    if (!hasPlaybackUrl || isInFullscreen) {
      return;
    }

    if (isActive && isScreenFocused && !isManuallyPaused) {
      player.play();
      return;
    }

    player.pause();
  }, [hasPlaybackUrl, isActive, isScreenFocused, isManuallyPaused, isInFullscreen, player]);

  useEffect(() => {
    if (status === 'error' && isInFullscreen) {
      void videoViewRef.current?.exitFullscreen();
    }
  }, [status, isInFullscreen]);

  // Auto-hide the play/pause icon shortly after playback starts, so it's a
  // brief confirmation rather than a permanent obstruction. While paused it
  // stays visible (set directly by handlePlayPause) so tapping-to-resume is
  // always discoverable.
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timeoutId = setTimeout(() => setIsIndicatorVisible(false), 900);

    return () => clearTimeout(timeoutId);
  }, [isPlaying]);

  const handlePlayPause = useCallback(() => {
    setIsIndicatorVisible(true);

    if (isPlaying) {
      player.pause();
      setIsManuallyPaused(true);
      return;
    }

    player.play();
    setIsManuallyPaused(false);
  }, [isPlaying, player]);

  const handleEnterFullscreen = useCallback(() => {
    void videoViewRef.current?.enterFullscreen();
  }, []);

  const handleNextEpisode = useCallback(() => {
    if (!nextEpisode) {
      return;
    }

    if (nextEpisode.accessType === 'premium') {
      setIsPremiumModalVisible(true);
      return;
    }

    router.push({ pathname: '/', params: { videoId: nextEpisode.videoId } });
  }, [nextEpisode]);

  const handleGoToFreeEpisode = useCallback(() => {
    setIsPremiumModalVisible(false);

    if (firstFreeEpisodeInSeries) {
      router.push({ pathname: '/', params: { videoId: firstFreeEpisodeInSeries.videoId } });
    }
  }, [firstFreeEpisodeInSeries]);

  const handleFullscreenEnter = useCallback(() => {
    setIsInFullscreen(true);
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  const handleFullscreenExit = useCallback(() => {
    setIsInFullscreen(false);
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.videoLayer}>
        {hasPlaybackError ? (
          <View style={styles.errorState}>
            <Text style={styles.errorTitle}>Video unavailable</Text>
            <Text style={styles.errorHint}>Check the local media server connection.</Text>
          </View>
        ) : (
          <VideoView
            contentFit={isHorizontal ? 'contain' : 'cover'}
            fullscreenOptions={{
              enable: isHorizontal,
              orientation: 'landscape',
              autoExitOnRotate: true,
            }}
            nativeControls={false}
            onFullscreenEnter={handleFullscreenEnter}
            onFullscreenExit={handleFullscreenExit}
            player={player}
            playsInline
            ref={videoViewRef}
            style={styles.video}
          />
        )}
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.bottomScrim,
          { bottom: subtitleSafeZoneHeight, height: subtitleSafeZoneHeight + 130 },
        ]}
      />

      {hasPlaybackError ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={handlePlayPause}
          style={({ pressed }) => [styles.playPauseButton, pressed && styles.buttonPressed]}>
          {isIndicatorVisible ? (
            <SymbolView
              name={{ ios: isPlaying ? 'pause.fill' : 'play.fill', android: isPlaying ? 'pause' : 'play_arrow', web: isPlaying ? 'pause' : 'play_arrow' }}
              size={28}
              tintColor="#fff"
            />
          ) : null}
        </Pressable>
      )}

      {hasPlaybackError || !isHorizontal ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={handleEnterFullscreen}
          style={({ pressed }) => [styles.fullscreenButton, pressed && styles.buttonPressed]}>
          <Text style={styles.fullscreenText}>Fullscreen</Text>
        </Pressable>
      )}

      {nextEpisode ? (
        <Pressable
          accessibilityRole="button"
          onPress={handleNextEpisode}
          style={({ pressed }) => [styles.nextEpisodeButton, pressed && styles.buttonPressed]}>
          <Text style={styles.nextEpisodeText}>Episode Berikutnya</Text>
        </Pressable>
      ) : null}

      <View style={[styles.content, { bottom: subtitleSafeZoneHeight }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/series/[id]', params: { id: video.seriesId } })
          }
          style={({ pressed }) => [styles.details, pressed && styles.buttonPressed]}>
          <View style={styles.metaRow}>
            <Text style={[styles.episode, styles.textShadow]}>
              Episode {video.episodeNumber}
            </Text>
            <Text style={[styles.channel, styles.textShadow]}>{video.channelName}</Text>
          </View>
          <Text numberOfLines={2} style={[styles.title, styles.textShadow]}>
            {video.title}
          </Text>
          <Text numberOfLines={1} style={[styles.caption, styles.textShadow]}>
            {video.caption}
          </Text>
        </Pressable>

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

      <PremiumPreviewModal
        onDismiss={() => setIsPremiumModalVisible(false)}
        onGoToFreeEpisode={firstFreeEpisodeInSeries ? handleGoToFreeEpisode : undefined}
        visible={isPremiumModalVisible}
      />
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
    width: '100%',
    height: '100%',
  },
  errorState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  errorHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#9ca3af',
    textAlign: 'center',
  },
  bottomScrim: {
    position: 'absolute',
    right: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
  },
  playPauseButton: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -32,
    marginLeft: -32,
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenButton: {
    position: 'absolute',
    top: 54,
    left: 18,
    minWidth: 74,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  fullscreenText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  nextEpisodeButton: {
    position: 'absolute',
    top: 54,
    right: 18,
    minWidth: 74,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  nextEpisodeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  content: {
    position: 'absolute',
    right: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 18,
    paddingHorizontal: 18,
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
  textShadow: {
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  episode: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fecdd3',
  },
  title: {
    marginTop: 8,
    fontSize: 19,
    lineHeight: 24,
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
    gap: 10,
  },
  actionButton: {
    minWidth: 52,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  actionButtonActive: {
    backgroundColor: 'rgba(209, 31, 63, 0.55)',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  actionValue: {
    marginTop: 2,
    fontSize: 11,
    color: '#e5e7eb',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
