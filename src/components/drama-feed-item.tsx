import { useEvent } from 'expo';
import { router } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BrandMark } from '@/components/brand-mark';
import { PremiumPreviewModal } from '@/components/premium-preview-modal';
import { FontFamily, Palette, Radius } from '@/constants/theme';
import { FeedProgressBar } from '@/components/feed-progress-bar';
import { useAppForeground } from '@/hooks/use-app-foreground';
import { useFeedBottomAnchor } from '@/hooks/use-feed-bottom-anchor';
import {
  logPlaybackDebug,
  playbackPlayerLabel,
  reportPlayingState,
} from '@/services/debug/playback-debug';
import { isDemoMode } from '@/services/demo/demo-mode';
import { useTranslation } from '@/stores/language';
import { trackEvent } from '@/services/analytics/analytics-queue';
import { recordVideoWatched } from '@/services/ads/ad-controller';
import { getTokens } from '@/services/auth/token-store';
import { useAdsStore } from '@/stores/ads-store';
import { useEntitlement } from '@/stores/entitlement';
import type { Episode } from '@/types/series';
import type { Video } from '@/types/video';

// How often the player emits a timeUpdate event, used to drive the
// bottom playback-progress bar - a throttle, not per-frame.
const TIME_UPDATE_INTERVAL_SECONDS = 0.25;


// How far two fingers have to spread (or close) before clear display toggles.
// Loose enough to feel effortless, tight enough that a two-finger scroll or a
// clumsy grab does not trigger it.
const PINCH_ACTIVATION_RATIO = 1.25;

// Height of the clear-display control strip. The progress bar is lifted by
// exactly this much while clear display is on, so it sits directly above the
// strip rather than behind it.
const CLEAR_CONTROLS_HEIGHT = 64;

const FAST_PLAYBACK_SPEED = 2;

// The quick-actions bar hides itself again rather than waiting to be
// dismissed, so a long press that was not meant to open anything costs the
// viewer nothing.
const QUICK_ACTIONS_TIMEOUT_MS = 4000;

/**
 * Distance between the first two active touches. Returns 0 for anything that
 * is not a two-finger gesture, which callers read as "not a pinch".
 */
export function touchDistance(
  touches: readonly { readonly pageX: number; readonly pageY: number }[]
): number {
  if (touches.length < 2) {
    return 0;
  }

  const [first, second] = touches;

  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}


// Above this length, the 1-line-clamped caption is likely to actually
// truncate, so it's worth offering a "Lebih banyak" expand affordance.
// Roughly the number of characters that fit on one line at the caption's size
// and column width. Above it the single-line caption really does ellipsize, so
// "more" is honest rather than decorative.
const CAPTION_EXPAND_THRESHOLD = 40;

// Caps how tall an expanded caption can grow, so an unusually long caption
// can't cover most of the video or collide with the action rail.
const CAPTION_EXPANDED_MAX_LINES = 6;

// How often to persist playback progress while a video is actively
// playing - a throttle, not a per-frame write.
const PROGRESS_WRITE_INTERVAL_MS = 5000;

// Slice 15A-S1: how often to add to the accumulated-active-playing-time
// counter that decides when a watch "counts" for ad pacing purposes, and
// the cumulative threshold (seconds) at which it counts.
const AD_WATCH_ACCUMULATION_TICK_MS = 1000;
const AD_WATCHED_THRESHOLD_SECONDS = 5;

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
  /**
   * Clear display: everything except the video and the progress bar steps
   * aside. Owned by the feed rather than the item so it survives swiping to
   * the next episode.
   */
  readonly isClearDisplay?: boolean;
  readonly onToggleClearDisplay?: (nextIsClearDisplay: boolean) => void;
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
  isClearDisplay = false,
  onToggleClearDisplay,
}: DramaFeedItemProps) {
  // Spread of the two fingers when the pinch began. Zeroed once a pinch has
  // fired so one gesture toggles clear display exactly once, however far the
  // fingers keep travelling.
  const pinchStartDistanceRef = useRef(0);
  // Deliberately per-item: a speed bump is something you reach for on one
  // clip, not a setting you expect to follow you through the whole feed.
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isQuickActionsVisible, setIsQuickActionsVisible] = useState(false);
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const isWideLayout = windowWidth >= WIDE_LAYOUT_BREAKPOINT;
  // Single source of truth for everything pinned to the bottom of the item.
  const { overlayBottom, progressBottom } = useFeedBottomAnchor();
  const { isPremium } = useEntitlement();
  const isAppForeground = useAppForeground();
  // Slice 15A-S1: whether an interstitial ad is currently on screen.
  // Folded into the existing autoplay effect below (rather than a second,
  // separate imperative pause/resume effect) so it composes correctly with
  // `isManuallyPaused` — an ad closing must never force-resume a video the
  // user had already paused themselves.
  const adVisible = useAdsStore((state) => state.adVisible);
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const [isInFullscreen, setIsInFullscreen] = useState(false);
  const [isPremiumModalVisible, setIsPremiumModalVisible] = useState(false);
  const [isIndicatorVisible, setIsIndicatorVisible] = useState(true);
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);
  // Phase 10, work unit 10-B3 (backend) / 10-M2 (mobile): `GET
  // /videos/:id/stream` now requires `Authorization: Bearer <accessToken>`.
  // `useVideoPlayer` doesn't go through `services/api/client.ts`'s
  // `request()` helper (it's the native player, not a fetch call), so the
  // token has to be attached directly via expo-video's own `headers`
  // option. Reading `token-store.ts` directly (not `useAuth()`) matches
  // that module's existing design: it's the shared, React-free source of
  // truth for the current token pair specifically so non-React callers
  // like this one don't need to thread the token through props.
  //
  // `hasPlaybackUrl` folds in "do we actually have a token to attach" too
  // (not just "is the URL string non-empty") — every downstream usage of
  // this flag (autoplay guard, progress-recording guard, the error-state
  // UI) already means "is there a real playable source," so a logged-out
  // guest correctly falls straight into the existing error-state UI
  // instead of a silently-stuck idle player with no source and no message.
  const accessToken = getTokens()?.accessToken;
  // A demo build plays clips bundled into the binary, so there is no
  // token-protected endpoint in front of them and nothing to authorise -
  // demanding a token there would hide the whole product behind a login for
  // no reason. Every other build keeps the Phase 10 contract intact:
  // `GET /videos/:id/stream` rejects an unauthenticated request, so without a
  // token there genuinely is nothing playable and the error state is correct.
  const requiresAccessToken = !isDemoMode();
  const hasPlaybackUrl =
    video.playbackUrl.length > 0 && (!requiresAccessToken || Boolean(accessToken));
  const videoViewRef = useRef<VideoView>(null);
  const isInFullscreenRef = useRef(false);
  const hasSeekedToResumeRef = useRef(false);
  const playbackHeaders = requiresAccessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : undefined;
  const playbackSource = hasPlaybackUrl
    ? { uri: video.playbackUrl, headers: playbackHeaders }
    : null;
  const player = useVideoPlayer(playbackSource, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_SECONDS;
  });

  // Stable per-instance label ("p1", "p2", ...) so [PlaybackDebug] lines can
  // tell "the same player kept playing" apart from "a new player was created".
  const playerLabel = playbackPlayerLabel(player);

  // THE one authoritative playback rule. Every play()/pause() the feed issues
  // flows from this single predicate via the reconciler effect below - no
  // other effect may start playback. (isInFullscreen is deliberately not part
  // of it: in native fullscreen the native controls own playback and the
  // reconciler abstains instead.)
  const shouldPlay =
    hasPlaybackUrl &&
    isActive &&
    isScreenFocused &&
    isAppForeground &&
    !isManuallyPaused &&
    !adVisible;

  // The setup callback above only runs once at player creation, so it can't
  // react to the isMuted preference changing (e.g. the user tapping the
  // sound toggle, or scrolling to a new active item) - that has to be a
  // separate effect kept in sync with the prop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = isMuted;
  }, [isMuted, player]);

  // Same shape as the mute mirror above: the setup callback runs once, so the
  // rate has to be pushed to the player whenever the choice changes. The
  // equality guard is load-bearing, not an optimisation: expo-video's iOS
  // playbackRate setter assigns AVPlayer.rate on EVERY write (its didSet runs
  // even for an unchanged value), and a non-zero rate STARTS playback - so an
  // unguarded mount-time write of the default 1 kicked off every mounted
  // item's player at once, video and audio, active or not.
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => {
    if (player.playbackRate !== playbackSpeed) {
      logPlaybackDebug('PLAYBACK_RATE_WRITE', {
        video: video.id,
        player: playerLabel,
        rate: playbackSpeed,
      });
      // eslint-disable-next-line react-hooks/immutability
      player.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, player, playerLabel, video.id]);

  useEffect(() => {
    if (!isQuickActionsVisible) {
      return;
    }

    const timer = setTimeout(() => setIsQuickActionsVisible(false), QUICK_ACTIONS_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isQuickActionsVisible]);
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

  // Dev-only evidence trail. PLAYING_CHANGED with playing=true on an item
  // whose isActive=false is the double-audio signature, and the registry
  // turns any two simultaneous playing=true reports into a loud
  // [PlaybackInvariantViolation] regardless of what started them.
  useEffect(() => {
    logPlaybackDebug('MOUNT', { video: video.id, player: playerLabel });

    return () => logPlaybackDebug('UNMOUNT', { video: video.id, player: playerLabel });
  }, [video.id, playerLabel]);

  useEffect(() => {
    logPlaybackDebug('ACTIVE_CHANGED', { video: video.id, player: playerLabel, isActive });
  }, [isActive, video.id, playerLabel]);

  useEffect(() => {
    logPlaybackDebug('FOCUS_CHANGED', {
      video: video.id,
      player: playerLabel,
      focused: isScreenFocused,
    });
  }, [isScreenFocused, video.id, playerLabel]);

  useEffect(() => {
    logPlaybackDebug('APP_STATE_CHANGED', {
      video: video.id,
      player: playerLabel,
      foreground: isAppForeground,
    });
  }, [isAppForeground, video.id, playerLabel]);

  useEffect(() => {
    logPlaybackDebug('PLAYER_STATUS', { video: video.id, player: playerLabel, status });
  }, [status, video.id, playerLabel]);

  useEffect(() => {
    logPlaybackDebug('PLAYING_CHANGED', {
      video: video.id,
      player: playerLabel,
      playing: isPlaying,
      isActive,
      desired: shouldPlay,
      muted: isMuted,
    });
    reportPlayingState(playerLabel, video.id, isPlaying);

    return () => reportPlayingState(playerLabel, video.id, false);
  }, [isPlaying, isActive, shouldPlay, isMuted, video.id, playerLabel]);

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

    // The single playback reconciler - the only effect allowed to call
    // play() or pause(). Skips a redundant play() when already playing:
    // repeated play() calls during fast swiping are a likely source of the
    // player's "play() request was interrupted" console errors.
    // Slice 15A-S1: `!adVisible` (inside shouldPlay) gates this the same
    // way - a video paused for an ad resumes automatically when the ad
    // closes (adVisible flips false and this effect re-runs), without
    // needing a second effect that could otherwise race this one.
    if (shouldPlay) {
      if (!player.playing) {
        logPlaybackDebug('PLAY_REQUEST', {
          video: video.id,
          player: playerLabel,
          status: player.status,
        });
        player.play();
      }
      return;
    }

    // The pause is deliberately NOT guarded by `player.playing`: that
    // property mirrors the native player's actual state, and it stays false
    // the whole time a play() is still pending or the clip is buffering (iOS
    // timeControlStatus `waitingToPlayAtSpecifiedRate`, Android ExoPlayer
    // STATE_BUFFERING). Guarding on it skipped the pause exactly when a
    // swiped-away item was mid-buffer, and the pending play() then started
    // audio under the new active item - two videos audible at once, looping
    // until the item left the render window. pause() on an already-paused
    // player is a native no-op, and JS->native player calls apply in order,
    // so a pause issued after a pending play always wins.
    logPlaybackDebug('PAUSE_REQUEST', {
      video: video.id,
      player: playerLabel,
      playing: player.playing,
      status: player.status,
    });
    player.pause();
  }, [shouldPlay, hasPlaybackUrl, isInFullscreen, player, playerLabel, video.id]);

  // Slice 15A-S1: resets the accumulated-watch-time counter whenever this
  // item stops being active, so the NEXT activation starts from zero and
  // `recordVideoWatched` can fire at most once per activation.
  const watchedSecondsRef = useRef(0);
  const hasRecordedAdWatchRef = useRef(false);

  useEffect(() => {
    if (isActive) {
      return;
    }

    watchedSecondsRef.current = 0;
    hasRecordedAdWatchRef.current = false;
  }, [isActive]);

  // Accumulates ACTIVE PLAYING time (not merely "active" - a manual pause
  // or a buffering stall stops the clock, but doesn't reset it) toward the
  // ad-pacing "this video counted as watched" threshold. Deliberately does
  // NOT use `playbackPositionSeconds`/`player.currentTime` as a proxy:
  // `player.loop = true` above wraps it, and the resume-seek effect makes
  // it non-monotonic on mount.
  useEffect(() => {
    if (!isActive || !isScreenFocused || !isPlaying) {
      return;
    }

    const intervalId = setInterval(() => {
      watchedSecondsRef.current += AD_WATCH_ACCUMULATION_TICK_MS / 1000;

      if (
        !hasRecordedAdWatchRef.current &&
        watchedSecondsRef.current >= AD_WATCHED_THRESHOLD_SECONDS
      ) {
        hasRecordedAdWatchRef.current = true;
        recordVideoWatched(video.id);
      }
    }, AD_WATCH_ACCUMULATION_TICK_MS);

    return () => clearInterval(intervalId);
  }, [isActive, isScreenFocused, isPlaying, video.id]);

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
    // Only the active item may drive playback from its tap target. A tap
    // landing on a mounted-but-inactive item (reachable on web, or during a
    // mid-swipe layout) must never start a second player.
    if (!isActive) {
      return;
    }

    setIsIndicatorVisible(true);

    if (isPlaying) {
      logPlaybackDebug('PAUSE_REQUEST', { video: video.id, player: playerLabel, manual: true });
      player.pause();
      setIsManuallyPaused(true);
      flushProgress();
      return;
    }

    logPlaybackDebug('PLAY_REQUEST', { video: video.id, player: playerLabel, manual: true });
    player.play();
    setIsManuallyPaused(false);
  }, [isActive, isPlaying, player, playerLabel, video.id, flushProgress]);

  const handleEnterFullscreen = useCallback(() => {
    void videoViewRef.current?.enterFullscreen();
  }, []);

  const handleNextEpisode = useCallback(() => {
    if (!nextEpisode) {
      return;
    }

    if (nextEpisode.accessType === 'premium' && !isPremium) {
      trackEvent('premium_gate_hit', {
        videoId: nextEpisode.videoId,
        seriesId: nextEpisode.seriesId,
        episodeNumber: nextEpisode.episodeNumber,
        source: 'feed-next-episode',
      });
      setIsPremiumModalVisible(true);
      return;
    }

    trackEvent('episode_navigate', {
      videoId: nextEpisode.videoId,
      seriesId: nextEpisode.seriesId,
      episodeNumber: nextEpisode.episodeNumber,
      source: 'feed-next-episode',
    });
    // Opens the series page rather than jumping straight into the next clip,
    // so the viewer lands on the episode list and can pick where to go.
    router.push({ pathname: '/series/[id]', params: { id: video.seriesId } });
  }, [nextEpisode, isPremium, video.seriesId]);

  const handleGoToFreeEpisode = useCallback(() => {
    setIsPremiumModalVisible(false);

    if (firstFreeEpisodeInSeries) {
      router.push({ pathname: '/', params: { videoId: firstFreeEpisodeInSeries.videoId } });
    }
  }, [firstFreeEpisodeInSeries]);

  const handleFullscreenEnter = useCallback(() => {
    logPlaybackDebug('FULLSCREEN', { video: video.id, player: playerLabel, entering: true });
    setIsInFullscreen(true);
    lockOrientation(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, [video.id, playerLabel]);

  const handleFullscreenExit = useCallback(() => {
    logPlaybackDebug('FULLSCREEN', { video: video.id, player: playerLabel, entering: false });
    setIsInFullscreen(false);
    lockOrientation(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    flushProgress();
  }, [video.id, playerLabel, flushProgress]);

  return (
    <View
      style={[styles.container, { height }]}
      // Capture phase, and only for a genuine two-finger gesture. Single-touch
      // interactions - tap to pause, swipe to the next episode, dragging the
      // scrubber - never reach here, so none of them change behaviour.
      onStartShouldSetResponderCapture={(event) => {
        const { touches } = event.nativeEvent;

        if (touches.length !== 2) {
          return false;
        }

        pinchStartDistanceRef.current = touchDistance(touches);

        return true;
      }}
      // Second chance to claim the gesture. If the touch-start negotiation was
      // missed - a child already held the responder, or the two fingers landed
      // in the same frame - the first two-finger move still takes over and
      // seeds the baseline here.
      onMoveShouldSetResponderCapture={(event) => {
        const { touches } = event.nativeEvent;

        if (touches.length !== 2) {
          return false;
        }

        if (pinchStartDistanceRef.current <= 0) {
          pinchStartDistanceRef.current = touchDistance(touches);
        }

        return true;
      }}
      onResponderMove={(event) => {
        const { touches } = event.nativeEvent;
        const startDistance = pinchStartDistanceRef.current;

        if (touches.length !== 2 || startDistance <= 0) {
          return;
        }

        const ratio = touchDistance(touches) / startDistance;

        if (!isClearDisplay && ratio >= PINCH_ACTIVATION_RATIO) {
          pinchStartDistanceRef.current = 0;
          onToggleClearDisplay?.(true);
        } else if (isClearDisplay && ratio <= 1 / PINCH_ACTIVATION_RATIO) {
          pinchStartDistanceRef.current = 0;
          onToggleClearDisplay?.(false);
        }
      }}
      onResponderRelease={() => {
        pinchStartDistanceRef.current = 0;
      }}
      onResponderTerminate={() => {
        pinchStartDistanceRef.current = 0;
      }}>
      <View style={styles.videoLayer}>
        {hasPlaybackError ? (
          <View style={styles.errorState}>
            <Text style={styles.errorTitle}>{t('feed.videoUnavailable')}</Text>
            <Text style={styles.errorHint}>{t('feed.videoUnavailableHint')}</Text>
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

      {hasPlaybackError || isClearDisplay ? null : (
        <Pressable
          testID="feed-item-play-pause"
          accessibilityRole="button"
          onPress={handlePlayPause}
          // Holding the middle of the screen is the way in to clear display.
          // It sits on the button that is already centred there, so there is
          // no second invisible target competing for the same touch.
          onLongPress={() => setIsQuickActionsVisible(true)}
          delayLongPress={400}
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

      {hasPlaybackError || !isHorizontal || isClearDisplay ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={handleEnterFullscreen}
          style={({ pressed }) => [styles.fullscreenButton, pressed && styles.buttonPressed]}>
          <Text style={styles.fullscreenText}>{t('feed.fullscreen')}</Text>
        </Pressable>
      )}

      {nextEpisode && !isClearDisplay ? (
        <Pressable
          accessibilityRole="button"
          onPress={handleNextEpisode}
          style={({ pressed }) => [styles.nextEpisodeButton, pressed && styles.buttonPressed]}>
          <Text style={styles.nextEpisodeText}>{t('feed.nextEpisode')}</Text>
        </Pressable>
      ) : null}

      <View
        testID="feed-item-bottom-overlay"
        pointerEvents={isClearDisplay ? 'none' : 'auto'}
        style={[styles.content, { bottom: overlayBottom }, isClearDisplay && styles.contentHidden]}>
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
          {/* The toggle cannot be nested inside the caption while collapsed:
              `numberOfLines={1}` clips everything past the first line, and a
              trailing child is exactly what gets clipped - which is why the
              affordance never actually appeared. Sitting beside the caption in
              a row, it survives the ellipsis. */}
          {isCaptionExpanded ? (
            <>
              <Text
                numberOfLines={CAPTION_EXPANDED_MAX_LINES}
                style={[styles.caption, styles.textShadow]}>
                {video.caption}
              </Text>
              <Text
                onPress={(event) => {
                  event.stopPropagation();
                  setIsCaptionExpanded(false);
                }}
                style={[styles.captionToggle, styles.captionToggleTrailing, styles.textShadow]}>
                {t('feed.less')}
              </Text>
            </>
          ) : (
            <View style={styles.captionRow}>
              <Text
                numberOfLines={1}
                style={[styles.caption, styles.captionCollapsed, styles.textShadow]}>
                {video.caption}
              </Text>
              {video.caption.length > CAPTION_EXPAND_THRESHOLD ? (
                <Text
                  onPress={(event) => {
                    event.stopPropagation();
                    setIsCaptionExpanded(true);
                  }}
                  style={[styles.captionToggle, styles.captionToggleInline, styles.textShadow]}>
                  {t('feed.more')}
                </Text>
              ) : null}
            </View>
          )}
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
            style={({ pressed }) => [styles.actionItem, pressed && styles.buttonPressed]}>
            <View style={styles.actionButton}>
              <SymbolView
                name={{
                  ios: isLiked ? 'heart.fill' : 'heart',
                  android: isLiked ? 'favorite' : 'favorite_border',
                  web: isLiked ? 'favorite' : 'favorite_border',
                }}
                size={24}
                tintColor={isLiked ? Palette.primary : '#fff'}
              />
            </View>
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

      {hasPlaybackError ? null : (
        <FeedProgressBar
          progressRatio={playbackProgressRatio}
          bottom={isClearDisplay ? progressBottom + CLEAR_CONTROLS_HEIGHT : progressBottom}
        />
      )}

      {isQuickActionsVisible && !isClearDisplay ? (
        <View style={styles.quickActions}>
          <Pressable
            accessibilityLabel="Tampilan bersih"
            accessibilityRole="button"
            onPress={() => {
              setIsQuickActionsVisible(false);
              onToggleClearDisplay?.(true);
            }}
            style={({ pressed }) => [styles.quickActionButton, pressed && styles.buttonPressed]}>
            <SymbolView
              name={{
                ios: 'arrow.up.left.and.arrow.down.right',
                android: 'fullscreen',
                web: 'fullscreen',
              }}
              size={18}
              tintColor="#fff"
            />
            <Text style={styles.quickActionText}>{t('feed.clearDisplay')}</Text>
          </Pressable>
        </View>
      ) : null}

      {isClearDisplay ? (
        <View style={styles.clearControls}>
          <Pressable
            accessibilityLabel="Keluar dari tampilan bersih"
            accessibilityRole="button"
            onPress={() => onToggleClearDisplay?.(false)}
            style={({ pressed }) => [styles.clearExitButton, pressed && styles.buttonPressed]}>
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={20}
              tintColor="#fff"
            />
          </Pressable>

          <View style={styles.clearControlGroup}>
            <Pressable
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              accessibilityRole="button"
              onPress={handlePlayPause}
              style={({ pressed }) => [styles.clearControlButton, pressed && styles.buttonPressed]}>
              <SymbolView
                name={{
                  ios: isPlaying ? 'pause.fill' : 'play.fill',
                  android: isPlaying ? 'pause' : 'play_arrow',
                  web: isPlaying ? 'pause' : 'play_arrow',
                }}
                size={20}
                tintColor="#fff"
              />
            </Pressable>
            <View style={styles.clearControlDivider} />
            <Pressable
              accessibilityLabel={`Kecepatan ${playbackSpeed}x`}
              accessibilityRole="button"
              onPress={() =>
                setPlaybackSpeed((current) => (current === 1 ? FAST_PLAYBACK_SPEED : 1))
              }
              style={({ pressed }) => [styles.clearControlButton, pressed && styles.buttonPressed]}>
              <Text style={styles.clearSpeedText}>{`${playbackSpeed}×`}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

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
  // The one piece of chrome clear display adds rather than removes: without a
  // visible way out, the only exit would be a gesture the viewer has to
  // already know about.
  // Sits just below the middle of the screen so the finger that opened it is
  // not covering it, and well clear of the caption underneath.
  quickActions: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '58%',
    alignItems: 'center',
  },
  quickActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(13, 13, 15, 0.92)',
    borderWidth: 1,
    borderColor: Palette.border,
  },
  quickActionText: {
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: '#fff',
  },
  clearControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: CLEAR_CONTROLS_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    backgroundColor: '#000',
  },
  clearExitButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  clearControlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 6,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  clearControlButton: {
    minWidth: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearControlDivider: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  clearSpeedText: {
    fontSize: 15,
    fontFamily: FontFamily.bold,
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  // Clear display is about reading the frame underneath, so the metadata and
  // the action rail step out of the way entirely.
  contentHidden: {
    opacity: 0,
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
  captionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  // Shrinks so the ellipsis lands before the toggle rather than pushing it off
  // the row.
  captionCollapsed: {
    flex: 1,
  },
  captionToggle: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  captionToggleInline: {
    marginLeft: 5,
  },
  captionToggleTrailing: {
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  actions: {
    alignItems: 'center',
    gap: 14,
  },
  // Like is the only action carrying a count, so the pill holds the icon alone
  // and the number sits underneath as a sibling. Putting both inside the fixed
  // 48px pill pushed the icon off its centre and squeezed the number against
  // the pill's border, which is why that one control read as broken next to
  // the other three.
  actionItem: {
    alignItems: 'center',
    gap: 5,
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
    fontSize: 12,
    fontFamily: FontFamily.bold,
    color: Palette.text,
    // Keeps the count from changing width as it ticks (18.7K -> 18.8K), which
    // would otherwise nudge the whole rail sideways on every like.
    fontVariant: ['tabular-nums'],
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
