import { useEvent } from 'expo';
import { router } from 'expo-router';
import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BrandMark } from '@/components/brand-mark';
import { PremiumPreviewModal } from '@/components/premium-preview-modal';
import { FontFamily, Palette, Radius } from '@/constants/theme';
import type { Episode } from '@/types/series';
import type { Video } from '@/types/video';

// How often the player emits a timeUpdate event, used to drive the
// bottom playback-progress bar - a throttle, not per-frame.
const TIME_UPDATE_INTERVAL_SECONDS = 0.25;

// useBottomTabBarHeight() (re-exported from expo-router's own vendored
// react-navigation/bottom-tabs) returns the tab bar's actual rendered
// height, safe-area inset already included, correct on both web and
// native - replaces the previous Platform.OS branch that guessed a fixed
// 56px on web and assumed native excludes the tab bar entirely from the
// content area (neither guess held up across real devices).
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

// screen-orientation lock is only meaningful where the OS actually exposes
// it (iOS/Android) - on web, lockAsync always rejects with a
// NotSupportedError, so it's skipped there entirely rather than caught
// after the fact.
function lockOrientation(orientation: ScreenOrientation.OrientationLock) {
  if (Platform.OS === 'web') {
    return;
  }

  ScreenOrientation.lockAsync(orientation).catch((lockError: unknown) => {
    if (__DEV__) {
      console.warn('[DramaFeedItem] Failed to lock screen orientation.', lockError);
    }
  });
}

// Above this viewport width (tablet-ish portrait), the metadata overlay's
// details block otherwise stretches to fill the full row width, which lets
// the title/caption text extend further down/across into the same lower
// portion of frame where a video's burned-in subtitle typically sits. Capping
// the block's width on wide screens keeps it compact without touching the
// bottom anchor or phone-width layout.
const WIDE_LAYOUT_BREAKPOINT = 700;
const DETAILS_MAX_WIDTH_WIDE = 440;

type DramaFeedItemProps = {
  readonly video: Video;
  readonly height: number;
  readonly isActive: boolean;
  readonly isScreenFocused: boolean;
  readonly isLiked: boolean;
  readonly isSaved: boolean;
  readonly isMuted: boolean;
  readonly likeCount: number;
  readonly nextEpisode?: Episode;
  readonly firstFreeEpisodeInSeries?: Episode;
  readonly resumePositionSeconds?: number;
  readonly onShare: () => void;
  readonly onToggleLike: () => void;
  readonly onToggleSave: () => void;
  readonly onToggleMute: () => void;
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
  isMuted,
  likeCount,
  nextEpisode,
  firstFreeEpisodeInSeries,
  resumePositionSeconds,
  onShare,
  onToggleLike,
  onToggleSave,
  onToggleMute,
  onRecordProgress,
}: DramaFeedItemProps) {
  const tabBarHeight = useBottomTabBarHeight();
  const { width: windowWidth } = useWindowDimensions();
  const isWideLayout = windowWidth >= WIDE_LAYOUT_BREAKPOINT;
  const metadataBottomOffset = tabBarHeight + BOTTOM_GAP;
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
    nextPlayer.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_SECONDS;
  });

  // The setup callback above only runs once at player creation, so it can't
  // react to the isMuted preference changing (e.g. the user tapping the
  // sound toggle, or scrolling to a new active item) - that has to be a
  // separate effect kept in sync with the prop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = isMuted;
  }, [isMuted, player]);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status, error } = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: null });
  const { currentTime: playbackPositionSeconds } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const playbackProgressRatio =
    player.duration > 0 ? Math.min(1, Math.max(0, playbackPositionSeconds / player.duration)) : 0;
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

    try {
      onRecordProgressRef.current(player.currentTime, player.duration || undefined);
    } catch {
      // On native, the underlying player's shared object can already be
      // released by the time this runs on final unmount teardown, throwing
      // "Unable to find the native shared object". Nothing left to flush
      // to in that case, so skip rather than crash.
    }
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
        lockOrientation(ScreenOrientation.OrientationLock.PORTRAIT_UP);
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

    // Skip redundant play()/pause() calls when already in the desired
    // state - repeated calls during fast swiping are a likely source of
    // the player's "play() request was interrupted" console errors.
    if (isActive && isScreenFocused && !isManuallyPaused) {
      if (!player.playing) {
        player.play();
      }
      return;
    }

    if (player.playing) {
      player.pause();
    }
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
    lockOrientation(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  const handleFullscreenExit = useCallback(() => {
    setIsInFullscreen(false);
    lockOrientation(ScreenOrientation.OrientationLock.PORTRAIT_UP);
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
            <View style={styles.playPauseCircle}>
              <SymbolView
                name={{ ios: isPlaying ? 'pause.fill' : 'play.fill', android: isPlaying ? 'pause' : 'play_arrow', web: isPlaying ? 'pause' : 'play_arrow' }}
                size={30}
                tintColor="#fff"
              />
            </View>
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

      {hasPlaybackError ? null : (
        <View style={[styles.progressTrack, { bottom: metadataBottomOffset - BOTTOM_GAP }]}>
          <View style={[styles.progressFill, { width: `${playbackProgressRatio * 100}%` }]} />
        </View>
      )}

      <View style={[styles.content, { bottom: metadataBottomOffset }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/series/[id]', params: { id: video.seriesId } })
          }
          style={({ pressed }) => [
            styles.details,
            isWideLayout && styles.detailsWide,
            pressed && styles.buttonPressed,
          ]}>
          <View style={styles.channelRow}>
            <BrandMark size={26} />
            <Text style={[styles.channel, styles.textShadow]}>{video.channelName}</Text>
          </View>
          <Text numberOfLines={2} style={[styles.title, styles.textShadow]}>
            {video.title}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.episodeBadge, styles.textShadow]}>
              EP {video.episodeNumber}
            </Text>
            <Text style={[styles.categoryChip, styles.textShadow]}>{video.category}</Text>
          </View>
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
          {hasPlaybackError ? null : (
            <Pressable
              accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
              accessibilityRole="button"
              onPress={onToggleMute}
              style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
              <SymbolView
                name={{
                  ios: isMuted ? 'speaker.slash.fill' : 'speaker.wave.2.fill',
                  android: isMuted ? 'volume_off' : 'volume_up',
                  web: isMuted ? 'volume_off' : 'volume_up',
                }}
                size={22}
                tintColor="#fff"
              />
            </Pressable>
          )}
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
              size={24}
              tintColor={isLiked ? Palette.primary : '#fff'}
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
              size={22}
              tintColor={isSaved ? Palette.primary : '#fff'}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="Share"
            accessibilityRole="button"
            onPress={onShare}
            style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
            <SymbolView
              name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
              size={22}
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
    backgroundColor: Palette.background,
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
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  errorHint: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  playPauseButton: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -38,
    marginLeft: -38,
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseCircle: {
    width: 76,
    height: 76,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(13, 13, 15, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
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
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  fullscreenText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  nextEpisodeButton: {
    position: 'absolute',
    top: 54,
    right: 18,
    minWidth: 74,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  nextEpisodeText: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Palette.primary,
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
  detailsWide: {
    flex: 0,
    maxWidth: DETAILS_MAX_WIDTH_WIDE,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 7,
  },
  textShadow: {
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  episodeBadge: {
    fontSize: 10.5,
    fontFamily: FontFamily.bold,
    letterSpacing: 0.5,
    color: Palette.text,
    backgroundColor: 'rgba(255, 122, 26, 0.92)',
    borderRadius: Radius.sm - 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  categoryChip: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: Radius.sm - 2,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    overflow: 'hidden',
  },
  title: {
    marginTop: 8,
    fontSize: 18,
    lineHeight: 23,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  channel: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  caption: {
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  captionExpandToggle: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  actions: {
    alignItems: 'center',
    gap: 14,
  },
  actionButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(24, 24, 27, 0.9)',
    borderWidth: 1,
    borderColor: Palette.border,
  },
  actionValue: {
    marginTop: 4,
    fontSize: 11,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
