import { useEvent } from 'expo';
import { router } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PremiumPreviewModal } from '@/components/premium-preview-modal';
import type { Episode } from '@/types/series';
import type { Video } from '@/types/video';

// Measured live (web): the bottom tab bar renders as an overlay and is NOT
// excluded from the feed item's own `height` - it sits in the last ~56px.
// On native, Expo Router's Tabs navigator already excludes the tab bar from
// the screen's content area, so only the bottom safe-area inset (home
// indicator / gesture bar) needs to be cleared there, not the full tab bar
// height - using the web-sized estimate on native would eat more video
// space than necessary.
const WEB_TAB_BAR_HEIGHT = 56;
const BOTTOM_GAP = 12;

// Above this length, the 1-line-clamped caption is likely to actually
// truncate, so it's worth offering a "Lebih banyak" expand affordance.
const CAPTION_EXPAND_THRESHOLD = 60;

// Caps how tall an expanded caption can grow, so an unusually long caption
// can't cover most of the video or collide with the action rail.
const CAPTION_EXPANDED_MAX_LINES = 6;

// How often to persist playback progress while a video is actively
// playing - a throttle, not a per-frame write.
const PROGRESS_WRITE_INTERVAL_MS = 5000;

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
  readonly resumePositionSeconds?: number;
  readonly onShare: () => void;
  readonly onToggleLike: () => void;
  readonly onToggleSave: () => void;
  readonly onRecordProgress?: (positionSeconds: number, durationSeconds?: number) => void;
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
  resumePositionSeconds,
  onShare,
  onToggleLike,
  onToggleSave,
  onRecordProgress,
}: DramaFeedItemProps) {
  const insets = useSafeAreaInsets();
  const tabBarClearance = Platform.OS === 'web' ? WEB_TAB_BAR_HEIGHT : insets.bottom;
  const metadataBottomOffset = tabBarClearance + BOTTOM_GAP;
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const [isInFullscreen, setIsInFullscreen] = useState(false);
  const [isPremiumModalVisible, setIsPremiumModalVisible] = useState(false);
  const [isIndicatorVisible, setIsIndicatorVisible] = useState(true);
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);
  const hasPlaybackUrl = video.playbackUrl.length > 0;
  const videoViewRef = useRef<VideoView>(null);
  const isInFullscreenRef = useRef(false);
  const hasSeekedToResumeRef = useRef(false);
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

  // Home passes a fresh onRecordProgress closure on every render (it's an
  // inline arrow per feed item), so reading it directly would make
  // flushProgress's identity churn every render too - and since
  // flushProgress is an effect dependency below, that churn combined with
  // recordProgress triggering a re-render caused an infinite update loop.
  // Storing it in a ref keeps flushProgress's own identity stable.
  const onRecordProgressRef = useRef(onRecordProgress);

  useEffect(() => {
    onRecordProgressRef.current = onRecordProgress;
  }, [onRecordProgress]);

  const flushProgress = useCallback(() => {
    if (!onRecordProgressRef.current || !hasPlaybackUrl) {
      return;
    }

    onRecordProgressRef.current(player.currentTime, player.duration || undefined);
  }, [hasPlaybackUrl, player]);

  // Resume once per mount, as soon as the player has a real duration to seek
  // within. Guarded by a ref so this never re-fires from later renders.
  useEffect(() => {
    if (
      hasSeekedToResumeRef.current ||
      !resumePositionSeconds ||
      resumePositionSeconds <= 0 ||
      status !== 'readyToPlay'
    ) {
      return;
    }

    hasSeekedToResumeRef.current = true;
    // seekBy is relative; currentTime is ~0 right as the player becomes
    // ready (before any playback has elapsed), so seeking forward by the
    // resume position lands at the right absolute spot.
    player.seekBy(resumePositionSeconds - player.currentTime);
  }, [status, resumePositionSeconds, player]);

  // Throttled progress write while this item is the one actually playing -
  // not on every frame, and cleared whenever it stops being active/playing.
  useEffect(() => {
    if (!isActive || !isScreenFocused || !isPlaying) {
      return;
    }

    const intervalId = setInterval(flushProgress, PROGRESS_WRITE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isActive, isScreenFocused, isPlaying, flushProgress]);

  // Flush immediately on unmount (e.g. scrolled far enough away to be
  // recycled) so the last few seconds of watching aren't lost to the next
  // throttled interval tick. Reads flushProgress via a ref and uses an
  // empty dependency array deliberately: keying this on [flushProgress]
  // means the cleanup re-fires whenever that identity changes (e.g. a
  // spurious effect re-run), which calls recordProgress with the current
  // (still advancing) playback position, triggers a real state update, and
  // re-renders - causing an infinite loop instead of a genuine unmount flush.
  const flushProgressRef = useRef(flushProgress);

  useEffect(() => {
    flushProgressRef.current = flushProgress;
  }, [flushProgress]);

  useEffect(() => {
    return () => {
      flushProgressRef.current();
    };
  }, []);

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
      flushProgress();
      return;
    }

    player.play();
    setIsManuallyPaused(false);
  }, [isPlaying, player, flushProgress]);

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
    flushProgress();
  }, [flushProgress]);

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

      <View style={[styles.content, { bottom: metadataBottomOffset }]}>
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
          <Text
            numberOfLines={isCaptionExpanded ? CAPTION_EXPANDED_MAX_LINES : 1}
            style={[styles.caption, styles.textShadow]}>
            {video.caption}
            {video.caption.length > CAPTION_EXPAND_THRESHOLD ? (
              <Text
                onPress={(event) => {
                  event.stopPropagation();
                  setIsCaptionExpanded((current) => !current);
                }}
                style={[styles.captionExpandToggle, styles.textShadow]}>
                {isCaptionExpanded ? '  Lebih sedikit' : '  Lebih banyak'}
              </Text>
            ) : null}
          </Text>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            accessibilityLabel={isLiked ? 'Unlike' : 'Like'}
            accessibilityRole="button"
            onPress={onToggleLike}
            style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
            <SymbolView
              name={{
                ios: isLiked ? 'heart.fill' : 'heart',
                android: isLiked ? 'favorite' : 'favorite_border',
                web: isLiked ? 'favorite' : 'favorite_border',
              }}
              size={26}
              tintColor={isLiked ? '#d11f3f' : '#fff'}
            />
            <Text style={[styles.actionValue, styles.textShadow]}>
              {formatLikeCount(likeCount)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={isSaved ? 'Unsave' : 'Save'}
            accessibilityRole="button"
            onPress={onToggleSave}
            style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
            <SymbolView
              name={{
                ios: isSaved ? 'bookmark.fill' : 'bookmark',
                android: isSaved ? 'bookmark' : 'bookmark_border',
                web: isSaved ? 'bookmark' : 'bookmark_border',
              }}
              size={26}
              tintColor={isSaved ? '#fbbf24' : '#fff'}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="Share"
            accessibilityRole="button"
            onPress={onShare}
            style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
            <SymbolView
              name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
              size={24}
              tintColor="#fff"
            />
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
  captionExpandToggle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#e5e7eb',
  },
  actions: {
    alignItems: 'center',
    gap: 10,
  },
  actionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  actionValue: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
