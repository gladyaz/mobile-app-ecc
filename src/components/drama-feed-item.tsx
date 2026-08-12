import { useEvent } from 'expo';
import { router } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PremiumPreviewModal } from '@/components/premium-preview-modal';
import { FontFamily, Palette, Radius } from '@/constants/theme';
import { FeedProgressBar } from '@/components/feed-progress-bar';
import { useAppForeground } from '@/hooks/use-app-foreground';
import { useFeedBottomAnchor } from '@/hooks/use-feed-bottom-anchor';
import { playbackPlayerLabel, reportPlayingState } from '@/services/debug/playback-invariant';
import { isDemoMode } from '@/services/demo/demo-mode';
import { useTranslation } from '@/stores/language';
import { PLAYBACK_SPEEDS, usePlaybackSpeedStore } from '@/stores/playback-speed';
import { trackEvent } from '@/services/analytics/analytics-queue';
import { recordVideoWatched } from '@/services/ads/ad-controller';
import { ApiError } from '@/services/api/client';
import { getTokens } from '@/services/auth/token-store';
import { isHlsPlaybackEnabled } from '@/services/videos/hls-playback-flag';
import { getPlaybackAuthorization, resolvePlaybackSource } from '@/services/videos/video-service';
import { useAdsStore } from '@/stores/ads-store';
import { useEntitlement } from '@/stores/entitlement';
import type { Episode } from '@/types/series';
import type { PlaybackAuthorization } from '@/types/playback';
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


// Mobile UI revision (2026-08-12): distance below the top safe-area inset at
// which the per-item title block sits. Home renders its brand overlay at
// `insets.top + 10` (see `(tabs)/index.tsx`); this offset places the title in
// the same upper-left hierarchy, clearly below that brand line, on every
// notch/Dynamic-Island/SE-class screen. The next-episode control shares this
// same band on the right, which is why the title overlay leaves its right
// edge free (see `titleOverlay`).
const TITLE_OVERLAY_TOP_OFFSET = 44;

// Review fix (cycle 1, Finding 1): the next-episode pill no longer shares
// the title's vertical band - its Indonesian label ("Episode Berikutnya")
// renders far wider than the pill's 74px minimum, so a shared band could
// overlap the title's second line and steal its taps. Anchoring the pill a
// fixed distance below the title block's maximum extent (2 title lines at
// 23px line-height + the meta line + breathing room) makes the two
// deterministically non-overlapping at every title length and locale.
const NEXT_EPISODE_TOP_OFFSET = TITLE_OVERLAY_TOP_OFFSET + 76;

// How often to persist playback progress while a video is actively
// playing - a throttle, not a per-frame write.
const PROGRESS_WRITE_INTERVAL_MS = 5000;

// Slice 15A-S1: how often to add to the accumulated-active-playing-time
// counter that decides when a watch "counts" for ad pacing purposes, and
// the cumulative threshold (seconds) at which it counts.
const AD_WATCH_ACCUMULATION_TICK_MS = 1000;
const AD_WATCHED_THRESHOLD_SECONDS = 5;

// Slice 11M: how long before a playback grant's real expiry to proactively
// refresh it - a margin, not a poll interval. Scheduled exactly once per
// grant, so a continuously-active item's URL is swapped for a fresh one
// before the old one can actually die mid-playback.
const PLAYBACK_AUTH_REFRESH_MARGIN_MS = 30 * 1000;

// 11R remediation ADDENDUM (2026-08-12, control workspace DECISIONS.md):
// how long an item must REMAIN active before its playback-authorization
// fetch actually fires. A ±1-per-gesture paging contract means a fast
// sequential swipe lands the "active" slot on every intermediate item, and
// - before this existed - each one fired its own authorization request on
// arrival: ~78 requests in ~2 minutes of real device browsing, tripping the
// backend's 60/min-per-user throttle on `GET /videos/:id/playback` and
// leaving the video stuck black. 400ms sits in the middle of the approved
// 300-500ms window: long enough that a swipe-straight-through never fires
// (a deliberate stop reads as "active" for far longer than a transit), short
// enough that a genuine landing never feels like it's waiting on purpose.
const PLAYBACK_AUTH_SETTLE_MS = 400;

// Bounded automatic recovery from a transient authorization failure (a
// network blip, or the backend's 60/min throttle itself - HTTP 429) for an
// item that never leaves the active slot - a scroll away and back already
// retries for free (see the reset alongside `wasActive` below), but a
// continuously-active item needs its own bounded retry so a single blip
// doesn't brick it permanently. Exponential (2s/4s/8s, no jitter - every
// other timer in this file is a plain fixed/scheduled delay, and a single
// client backing off on its own schedule is enough here since the settle-
// window debounce above is what stops a burst of DIFFERENT items from ever
// synchronizing in the first place) rather than flat, so a genuinely
// sustained 429 window is given increasing room to clear instead of being
// hammered at a constant cadence. Capped, not indefinite: hammering a
// permanently-failing case (e.g. a revoked entitlement) forever would be its
// own kind of waste - and a 403 ENTITLEMENT_REQUIRED is never even
// classified as retryable in the first place (see
// `isRetryablePlaybackAuthError` below), so it never reaches this budget at
// all.
const PLAYBACK_AUTH_RETRY_DELAYS_MS = [2000, 4000, 8000] as const;
const MAX_PLAYBACK_AUTH_AUTO_RETRIES = PLAYBACK_AUTH_RETRY_DELAYS_MS.length;

/**
 * Only an HTTP 429 (the backend's own per-user throttle - the exact failure
 * mode this ADDENDUM exists to recover from) or a genuine network failure
 * (`ApiError` status 0, code `NETWORK_ERROR` - see `services/api/client.ts`)
 * is worth automatically retrying. Every other failure - most importantly a
 * 403 `ENTITLEMENT_REQUIRED` (the viewer genuinely does not have access) -
 * is a legitimate, stable "unavailable" state: hammering it on a timer would
 * not fix it, and would just add load for nothing. `status === 0` is
 * deliberately NOT used as the network-error test on its own - a missing
 * `EXPO_PUBLIC_API_BASE_URL` also carries status 0
 * (`ApiError(0, 'MISSING_BASE_URL', ...)`), and that is a standing
 * misconfiguration, not a transient blip.
 */
function isRetryablePlaybackAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 429 || error.code === 'NETWORK_ERROR');
}

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

// Above this viewport width (tablet-ish portrait), the title overlay would
// otherwise stretch most of the way across the frame. Capping its width on
// wide screens keeps it the same compact upper-left block it is on phones.
const WIDE_LAYOUT_BREAKPOINT = 700;
const TITLE_MAX_WIDTH_WIDE = 440;

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
  // Session-scoped, not per-item (a product decision that reversed the
  // earlier per-clip design): the chosen speed follows the viewer to the
  // next active video and only resets on a cold app restart, because the
  // store is memory-only - deliberately never persisted. Shared state means
  // a change re-renders every mounted item, so the rate mirror effect below
  // MUST keep its `shouldPlay` gate: it alone keeps the inactive copies
  // from touching their players.
  const playbackSpeed = usePlaybackSpeedStore((state) => state.speed);
  const setPlaybackSpeed = usePlaybackSpeedStore((state) => state.setSpeed);
  const [isQuickActionsVisible, setIsQuickActionsVisible] = useState(false);
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const isWideLayout = windowWidth >= WIDE_LAYOUT_BREAKPOINT;
  // Single source of truth for everything pinned to the bottom of the item.
  const { overlayBottom, progressBottom } = useFeedBottomAnchor();
  // Top anchor for the upper-left title block and the next-episode control -
  // inset-aware so neither collides with the status bar/notch.
  const insets = useSafeAreaInsets();
  const { isPremium } = useEntitlement();
  const isAppForeground = useAppForeground();
  // Slice 15A-S1: whether an interstitial ad is currently on screen.
  // Folded into the existing autoplay effect below (rather than a second,
  // separate imperative pause/resume effect) so it composes correctly with
  // `isManuallyPaused` — an ad closing must never force-resume a video the
  // user had already paused themselves.
  const adVisible = useAdsStore((state) => state.adVisible);
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  // Slice 11M / MEDIUM-6: counts consecutive automatic playback-authorization
  // retries for the current active stint. Real state, not a ref: the
  // scheduled-refresh-or-retry effect further down needs to actually
  // RE-RUN after each failed retry to decide whether to schedule the next
  // one, and a ref write cannot trigger that (nor may it be written during
  // render - see the reset blocks below).
  const [authRetryAttempt, setAuthRetryAttempt] = useState(0);
  // 11R remediation ADDENDUM: which class of failure the current
  // `hasPlaybackAuthError` represents - only true for a 429 (the backend's
  // own throttle) or a network error, per `isRetryablePlaybackAuthError`
  // below. The scheduled retry effect further down reads this instead of
  // retrying blindly, which is what keeps a 403 `ENTITLEMENT_REQUIRED` (or
  // any other permanent failure) from ever being hammered on a timer.
  // Declared here (ahead of `hasPlaybackAuthError` itself, out of its usual
  // grouping below) because the deactivation reset block immediately after
  // `wasActive` needs to reset it too.
  const [isAuthErrorRetryable, setIsAuthErrorRetryable] = useState(false);
  // A tap-to-pause is a choice about the episode in front of the viewer, not
  // a lasting property of that episode. Without this reset it becomes one:
  // `isManuallyPaused` feeds `shouldPlay`, so swiping away from a paused
  // episode and back would leave it silently refusing to play. Adjusted
  // during render rather than in an effect - the React-documented pattern for
  // resetting state when a prop changes, and the one that avoids the extra
  // render pass an effect would cost.
  const [wasActive, setWasActive] = useState(isActive);

  if (wasActive !== isActive) {
    setWasActive(isActive);

    if (!isActive) {
      setIsManuallyPaused(false);
      // A scroll-away is its own fresh start: the next activation gets a
      // full new budget of automatic authorization retries rather than
      // inheriting whatever was left over from this stint.
      setAuthRetryAttempt(0);
      // 11R remediation ADDENDUM: the retryability of a failure that
      // belonged to THIS stint must not leak into whatever the next stint's
      // own failure (if any) turns out to be.
      setIsAuthErrorRetryable(false);
    }
  }
  const [isInFullscreen, setIsInFullscreen] = useState(false);
  const [isPremiumModalVisible, setIsPremiumModalVisible] = useState(false);
  const [isIndicatorVisible, setIsIndicatorVisible] = useState(true);
  // Slice 11M: the feed no longer plays `video.playbackUrl` directly. That
  // field still exists (Share continues to use it), but the backend's
  // `/videos/:id/stream` 404s for R2-backed media (empty local storageKey)
  // - see the control workspace `DECISIONS.md`, "Slice 11M approved;
  // playback contract decided (Option A, dedicated endpoint)", 2026-08-08.
  // A real, playable URL now comes ONLY from `GET /videos/:id/playback`
  // (`getPlaybackAuthorization`, requested below), which answers for
  // multiple storage/delivery kinds - legacy local/R2-MP4, and (Slice 11R)
  // HLS - so this component stays ignorant of which one it got: the
  // returned union's `kind` and `resolvePlaybackSource` decide the source
  // and headers, never a hardcoded assumption here. That request is fired
  // ONLY for the active item -
  // signing (or, in a demo build, resolving) a URL nobody is watching is
  // pure waste - so `playbackAuth` starts and stays `null` for every
  // off-screen item.
  //
  // `hasPlaybackUrl` therefore now means "authorization has actually
  // arrived," not merely "we have a token" - every downstream usage of this
  // flag (autoplay guard, progress-recording guard, the error-state UI)
  // already means "is there a real playable source right now."
  const accessToken = getTokens()?.accessToken;
  // A demo build plays clips bundled into the binary, so there is no
  // token-protected endpoint in front of them and nothing to authorise -
  // demanding a token there would hide the whole product behind a login for
  // no reason. Every other build keeps the Phase 10 contract intact: the
  // real stream/presigned URL this resolves to requires a real session, so
  // without a token there genuinely is nothing to authorize.
  const requiresAccessToken = !isDemoMode();
  const [playbackAuth, setPlaybackAuth] = useState<PlaybackAuthorization | null>(null);
  const [hasPlaybackAuthError, setHasPlaybackAuthError] = useState(false);
  // Guards `handlePlayPause`'s re-authorization branch against stacking a
  // second concurrent network request while one is already in flight - a
  // rapid series of taps (exactly what a viewer does when a video is stuck
  // black, per the 2026-08-12 remediation ADDENDUM's field report) must
  // collapse to at most one outstanding request, not one per tap.
  const [isPlaybackAuthRequestInFlight, setIsPlaybackAuthRequestInFlight] = useState(false);
  // A cached grant belongs to the video it was fetched for, never to
  // whatever video this component instance happens to hold later. Reset
  // here using the same render-time "reset when a prop changes" pattern as
  // `wasActive` above (not an effect, for the same avoid-an-extra-render
  // reason), so a component instance that receives a DIFFERENT video while
  // holding a still-valid grant never plays the PREVIOUS video's URL under
  // the NEW video's metadata. Not reachable through today's keyed FlatList
  // (each mounted instance owns one video id for its whole lifetime), but
  // cheap insurance against a future caller that recycles instances.
  const [lastVideoId, setLastVideoId] = useState(video.id);

  if (lastVideoId !== video.id) {
    setLastVideoId(video.id);
    setPlaybackAuth(null);
    setHasPlaybackAuthError(false);
    setAuthRetryAttempt(0);
    setIsAuthErrorRetryable(false);
  }

  // Kept in sync via a LAYOUT effect, not a plain `useEffect` (this file's
  // lint config also disallows writing `ref.current` directly during
  // render - refs may only be read/written outside of render). A regular
  // `useEffect` is deferred until after paint, which leaves a narrow
  // commit -> passive-effect-flush window where an in-flight promise's
  // `.then` (a microtask, which can run before that deferred flush) would
  // still read the previous value. `useLayoutEffect` runs synchronously as
  // part of the same commit, closing that window.
  const isActiveRef = useRef(isActive);

  useLayoutEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);
  // Distinguishes "the latest authorization request for this item" from
  // any earlier one still in flight. Bumped every time a new request is
  // issued; a response is only ever applied when its own id still matches
  // the current value, which is what makes a superseded (or now-inactive)
  // response a safe no-op instead of wiring up a stale/dead URL.
  const playbackRequestIdRef = useRef(0);
  // 11R remediation ADDENDUM (fix cycle 2, Finding 1): mirrors
  // `isPlaybackAuthRequestInFlight` state, but as a ref so it can be read
  // AT FIRE TIME by a `setTimeout` callback scheduled by one of the two
  // effects below. React state read inside such a closure is whatever it
  // was WHEN THE EFFECT RAN (the timer was scheduled), not necessarily
  // current when the timer actually fires - a tap that starts a request
  // AFTER the timer was scheduled but BEFORE it fires would be invisible to
  // a state-only check. This ref is set/cleared in `requestAuthorization`'s
  // try/finally below, in lockstep with the state, so every scheduled
  // callback (and `requestAuthorization` itself, as a final symmetric
  // guard for every entry point - effects, play-press, and any future
  // caller) can bail out on the CURRENT in-flight status instead of
  // dispatching a second concurrent request for this item.
  const isPlaybackAuthRequestInFlightRef = useRef(false);
  // 11R remediation ADDENDUM: `true` only for the very first authorization
  // fetch this mounted instance will ever need, AND only when it is already
  // the active item on its first render - lazy `useRef` init runs exactly
  // once, at mount, so a later `isActive` change never re-arms it. That one
  // fetch (cold app start, or "the one active item" shape almost every
  // caller renders) skips the settle-window debounce below so normal
  // startup latency is unaffected; every later activation - in particular a
  // PROP TRANSITION from inactive to active on an instance that was already
  // sitting mounted-but-off-screen, which is exactly the shape a fast,
  // ±1-per-gesture scroll produces as it passes over each pre-mounted
  // neighbour - is debounced. Consumed (set false) the first time it is
  // actually used, so it can only ever skip the debounce once per instance.
  const skipAuthDebounceOnceRef = useRef(isActive);
  // Slice 11R: the ONE call site that turns a resolved playback
  // authorization (either the HLS or the legacy/MP4 shape - see
  // `types/playback.ts`) into an `expo-video` source. Routing BOTH shapes
  // through this same `playbackSource` state + `useVideoPlayer` path (rather
  // than a second, parallel HLS-only path) is what keeps every existing
  // active-item-only / single-player guard below applying identically to an
  // HLS source - there is no separate code path for it to slip past.
  // `resolvePlaybackSource` returns `null` for an HLS authorization while
  // the prefer-MP4 rollback flag is disabled; `hasPlaybackUrl` folds that
  // into the same "no real playable source" state as "authorization hasn't
  // arrived yet" / "authorization failed" below.
  const playbackSource = useMemo(
    () => (playbackAuth ? resolvePlaybackSource(playbackAuth, accessToken, isHlsPlaybackEnabled()) : null),
    [playbackAuth, accessToken]
  );
  const hasPlaybackUrl = playbackSource !== null;
  const videoViewRef = useRef<VideoView>(null);
  const isInFullscreenRef = useRef(false);
  const hasSeekedToResumeRef = useRef(false);
  const player = useVideoPlayer(playbackSource, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_SECONDS;
  });

  // THE only function that calls `getPlaybackAuthorization`. Both effects
  // below (initial-activation/reactivation fetch, and the scheduled
  // refresh-or-retry effect) call this instead of duplicating its
  // request-issuing/race-guard logic, so there remains exactly one place
  // that actually issues a request.
  //
  // Runs as an async function rather than calling `setXxx` synchronously in
  // an effect body (matching `stores/entitlement.tsx`'s existing hydration
  // pattern) - satisfying `react-hooks/set-state-in-effect` ("subscribe/
  // fire-and-forget, don't set state synchronously in the effect body").
  const requestAuthorization = useCallback(async () => {
    // 11R remediation ADDENDUM (fix cycle 2, Finding 1): final, symmetric
    // guard for every entry point (the debounce-settle effect, the
    // refresh/retry effect, and `handlePlayPause`) - if a request for this
    // item is already outstanding, skip dispatching a second one rather
    // than relying on each call site to remember to check first. This does
    // not starve the item: the in-flight request's own completion sets
    // `playbackAuth` or `hasPlaybackAuthError`, both of which are
    // dependencies of the two scheduling effects below, so they re-run and
    // schedule whatever comes next (a refresh, a retry) off the fresh
    // result - a skipped duplicate is never a skipped fetch.
    if (isPlaybackAuthRequestInFlightRef.current) {
      return;
    }

    // No token yet means the real endpoint would just 401 - skip the
    // network round trip entirely and fail the same way synchronously,
    // matching the pre-Slice-11M "logged out -> error state" behavior.
    // Demo builds need no token at all (requiresAccessToken is false
    // there).
    if (requiresAccessToken && !accessToken) {
      setPlaybackAuth(null);
      setHasPlaybackAuthError(true);
      setIsAuthErrorRetryable(false);
      return;
    }

    playbackRequestIdRef.current += 1;
    const requestId = playbackRequestIdRef.current;
    setHasPlaybackAuthError(false);
    // 11R remediation ADDENDUM: flipped for the lifetime of THIS request
    // only (see the `finally` block's own requestId check below) - it is
    // what lets `handlePlayPause`'s re-authorization branch tell "already
    // fetching, do nothing" from "nothing in flight, go ahead." The ref is
    // set in lockstep so a scheduled callback firing later reads the same
    // truth (see the ref's own comment above).
    setIsPlaybackAuthRequestInFlight(true);
    isPlaybackAuthRequestInFlightRef.current = true;

    try {
      const authorization = await getPlaybackAuthorization(video.id);

      // Drop the response if a newer request has since been issued for
      // this item, or if the item is no longer the active one - either
      // way, this result is stale and must never reach the player.
      if (playbackRequestIdRef.current !== requestId || !isActiveRef.current) {
        return;
      }

      // Defense-in-depth: `video-service.ts` already validates the response
      // shape and throws on anything malformed, but an empty `playbackUrl`
      // is a silent, permanent black screen (neither the error state nor a
      // spinner) if it ever slipped through - treat it as a failure, never
      // as "nothing to do yet." `resolvePlaybackSource` deliberately does
      // NOT perform this emptiness check itself (its contract is to echo
      // the backend-provided URL byte-for-byte, not to re-validate it) so
      // it stays here, same as before Slice 11R.
      const hasEmptyMp4Url = authorization.kind === 'mp4' && authorization.playbackUrl.length === 0;

      // Slice 11R: an HLS authorization while the prefer-MP4 rollback flag
      // is disabled resolves to `null` from the selector - there is no MP4
      // URL embedded inside an HLS response to fall back to, so that also
      // lands on the same "video unavailable" state.
      const resolvedSource = resolvePlaybackSource(
        authorization,
        accessToken,
        isHlsPlaybackEnabled()
      );

      if (hasEmptyMp4Url || !resolvedSource) {
        setPlaybackAuth(null);
        setHasPlaybackAuthError(true);
        // Neither failure mode above is a 429/network blip - a resolved 200
        // response that turns out unusable is its own stable "unavailable"
        // state, not something a timer could ever fix.
        setIsAuthErrorRetryable(false);
        return;
      }

      setAuthRetryAttempt(0);
      setIsAuthErrorRetryable(false);
      setPlaybackAuth(authorization);
    } catch (requestError) {
      if (playbackRequestIdRef.current !== requestId || !isActiveRef.current) {
        return;
      }

      setPlaybackAuth(null);
      setHasPlaybackAuthError(true);
      setIsAuthErrorRetryable(isRetryablePlaybackAuthError(requestError));
    } finally {
      if (playbackRequestIdRef.current === requestId) {
        setIsPlaybackAuthRequestInFlight(false);
        isPlaybackAuthRequestInFlightRef.current = false;
      }
    }
  }, [video.id, accessToken, requiresAccessToken]);

  // 11R remediation ADDENDUM (fix cycle 2, Finding 1): a request left
  // outstanding by the PREVIOUS `requestAuthorization` identity (i.e. for
  // the previous video.id/accessToken/requiresAccessToken generation) must
  // never block the FIRST request of a NEW one - that old request is
  // already destined to be ignored on arrival via the `playbackRequestIdRef`
  // staleness check above, which is what lets a genuinely newer request
  // supersede it instead of the two racing. Without this reset, the
  // in-flight guard added above would (incorrectly) treat that now-stale
  // pending request as still blocking, silently dropping the new
  // generation's own first fetch. `requestAuthorization` is only recreated
  // when one of its three deps actually changes, so this deliberately does
  // NOT fire on every render - only on an actual identity change, leaving
  // the same-generation duplicate-request guard (debounce vs. a press, a
  // scheduled retry vs. a press) fully intact.
  useEffect(() => {
    isPlaybackAuthRequestInFlightRef.current = false;
  }, [requestAuthorization]);

  // Fetches on activation (or reactivation, or a video-id change while
  // already active) whenever there is no still-valid cached grant. Gated on
  // `isActive` alone (not `isScreenFocused`/`isAppForeground`/etc. - those
  // only govern whether an already-authorized item plays, not whether it
  // may fetch authorization at all) so an off-screen item never signs a URL
  // nobody is about to watch. Reuses a still-valid `playbackAuth` across a
  // brief deactivation/reactivation instead of re-fetching.
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const isExpired = playbackAuth ? Date.parse(playbackAuth.expiresAt) <= Date.now() : true;

    if (playbackAuth && !isExpired) {
      return;
    }

    // 11R remediation ADDENDUM: the one-time cold-start/"already the active
    // item" exemption described above `skipAuthDebounceOnceRef`. Consumed
    // immediately so it can only ever fire once for this instance.
    if (skipAuthDebounceOnceRef.current) {
      skipAuthDebounceOnceRef.current = false;
      void requestAuthorization();
      return;
    }

    // Every other landing waits out the settle window first. If `isActive`
    // (or the other dependencies) change before it elapses - most
    // importantly, the item leaving the active slot again - this effect's
    // own cleanup clears the pending timer below, so a transient landing
    // fires the request ZERO times, not merely "later."
    const timeoutId = setTimeout(() => {
      // 11R remediation ADDENDUM (fix cycle 2, Finding 1): a tap on the play
      // button can fire its own request between this timer being scheduled
      // and it actually elapsing - checked here, AT FIRE TIME, via the ref
      // (not `isPlaybackAuthRequestInFlight` state, which this closure
      // captured back when the effect ran and would still read as `false`).
      // `requestAuthorization` re-checks the same ref itself, so this call
      // site check is a belt-and-suspenders skip, not the only guard.
      if (isPlaybackAuthRequestInFlightRef.current) {
        return;
      }

      void requestAuthorization();
    }, PLAYBACK_AUTH_SETTLE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isActive, playbackAuth, requestAuthorization]);

  // A SINGLE scheduled timer (never a polling loop) that either refreshes
  // an about-to-expire grant, or retries a failed one, while - and only
  // while - the item stays active. Without this, `player.loop = true`
  // means a continuously-active item would keep looping on a dead URL
  // forever once its 15-minute grant expired, landing in a permanent
  // "video unavailable" that only leaving and re-entering the active slot
  // could clear.
  useEffect(() => {
    if (!isActive) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const msUntilExpiry = playbackAuth ? Date.parse(playbackAuth.expiresAt) - Date.now() : null;

    if (msUntilExpiry !== null && msUntilExpiry > 0) {
      // Scheduled with a safety margin before the real expiry, so the swap
      // to a freshly-signed URL happens before the old one can actually die
      // mid-playback, not in a race with it. A grant that is ALREADY
      // expired by the time this effect runs is deliberately NOT handled
      // here - the activation effect above's own `isExpired` check already
      // fires a request for that case, and scheduling a second one here
      // too (at a clamped 0 ms delay) would double-fire for the exact same
      // need.
      const refreshDelayMs = Math.max(0, msUntilExpiry - PLAYBACK_AUTH_REFRESH_MARGIN_MS);

      timeoutId = setTimeout(() => {
        // The item may have left the active slot while this was pending -
        // a refresh must never hand a freshly-signed URL to a player that
        // is no longer the one being watched.
        if (!isActiveRef.current) {
          return;
        }

        // 11R remediation ADDENDUM (fix cycle 2, Finding 1): AT FIRE TIME,
        // not the state this closure captured when the effect ran - a tap
        // (or the other scheduled effect) may already have a request
        // outstanding for this item by the time this timer elapses.
        if (isPlaybackAuthRequestInFlightRef.current) {
          return;
        }

        void requestAuthorization();
      }, refreshDelayMs);
    } else if (
      !playbackAuth &&
      hasPlaybackAuthError &&
      isAuthErrorRetryable &&
      authRetryAttempt < MAX_PLAYBACK_AUTH_AUTO_RETRIES
    ) {
      // 11R remediation ADDENDUM: `isAuthErrorRetryable` is what keeps this
      // branch from ever firing for a 403 `ENTITLEMENT_REQUIRED` (or any
      // other permanent failure) - only a 429 or a network error sets it.
      // Exponential backoff (2s/4s/8s): `authRetryAttempt` indexes directly
      // into the delay table, so the Nth automatic retry always waits the
      // Nth delay regardless of how many attempts preceded it.
      const retryDelayMs =
        PLAYBACK_AUTH_RETRY_DELAYS_MS[authRetryAttempt] ?? PLAYBACK_AUTH_RETRY_DELAYS_MS.at(-1);

      timeoutId = setTimeout(() => {
        if (!isActiveRef.current) {
          return;
        }

        // 11R remediation ADDENDUM (fix cycle 2, Finding 1): AT FIRE TIME -
        // a tap on the "Video unavailable" pressable during this backoff
        // window already starts its own request via `handlePlayPause`, and
        // this scheduled retry must not stack a second one on top of it.
        // Bailing out here does not lose the retry: it is `requestId`-gated
        // the same way a superseded response already is, and the OTHER
        // request in flight (the tap's) still resolves into
        // `playbackAuth`/`hasPlaybackAuthError`, which re-runs this effect
        // and re-evaluates whether another retry is still needed.
        if (isPlaybackAuthRequestInFlightRef.current) {
          return;
        }

        // Real state, not a ref: this MUST cause a re-render so the effect
        // re-runs and can decide whether to schedule the NEXT retry - a
        // repeat failure leaves `hasPlaybackAuthError`/`playbackAuth`
        // unchanged, so a ref bump alone would never re-trigger this effect
        // again after the first retry.
        setAuthRetryAttempt((current) => current + 1);
        void requestAuthorization();
      }, retryDelayMs);
    }

    return () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    isActive,
    playbackAuth,
    hasPlaybackAuthError,
    isAuthErrorRetryable,
    requestAuthorization,
    authRetryAttempt,
  ]);

  // Stable per-instance label ("p1", "p2", ...) so a reported invariant
  // violation names which players were audible at the same time.
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
  // rate has to be pushed to the player whenever the choice changes.
  //
  // Both guards are load-bearing, not optimisations. On iOS a rate write IS a
  // play command: expo-video's setter assigns AVPlayer.rate on every write
  // (its didSet runs even for an unchanged value), and a non-zero rate starts
  // playback. An unguarded mount-time write of the default 1 is what started
  // every mounted item's player at once. So:
  //   - `shouldPlay` keeps the write inside the window where playback is
  //     already intended, which is the only place it cannot start anything
  //     that was meant to stay silent. A rate chosen while the item is
  //     inactive or paused is remembered in the session store and applied
  //     by this same effect when the item becomes eligible again - the
  //     same path that hands the NEXT active item the session speed on
  //     activation.
  //   - the equality check keeps a re-render from re-issuing an identical
  //     write, since even that would restart a paused player.
  useEffect(() => {
    if (!shouldPlay) {
      return;
    }

    if (player.playbackRate !== playbackSpeed) {
      // eslint-disable-next-line react-hooks/immutability
      player.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, shouldPlay, player]);

  // When expo-video hands back a NEW player for the same item - it re-creates
  // one whenever the source object changes, e.g. after an access-token
  // refresh rotates the Authorization header - the outgoing instance is only
  // release()d, never paused. Pausing it here, as this effect's cleanup, is
  // what stops a still-audible player from outliving the component that owned
  // it. Also runs on unmount, where it is harmless: release() follows.
  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // On native the shared object can already be released by the time
        // this runs during teardown; there is nothing left to pause then.
      }
    };
  }, [player]);

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

  // Feeds the development-only single-playing-player check. Reporting the
  // observed state (rather than the intended one) is what makes it catch a
  // second player becoming audible no matter which code path started it.
  useEffect(() => {
    reportPlayingState(playerLabel, video.id, isPlaying);

    return () => reportPlayingState(playerLabel, video.id, false);
  }, [isPlaying, video.id, playerLabel]);

  // Deliberately NOT `!hasPlaybackUrl` anymore: that's also true for an
  // off-screen item that has never requested authorization, or an active
  // item whose request just hasn't resolved yet - neither is a failure.
  // Only an explicit authorization failure or a player-reported error
  // counts as "this cannot play."
  const hasPlaybackError = hasPlaybackAuthError || status === 'error';
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
    // Never log the playback URL. A presigned R2 URL carries its signature
    // in the query string, and even the local-stream URL is a
    // backend-internal address - both stay out of this log even though
    // it's __DEV__-only, since it still lands in Metro output, device
    // logs, CI logs, and screen shares. Log the video id and a sanitized
    // reason instead.
    const reason = hasPlaybackAuthError
      ? 'authorization failed'
      : error
        ? `player error: ${error.message}`
        : 'unknown';

    console.warn(`[DramaFeedItem] Unable to play video ${video.id}. reason=${reason}`);
  }, [error, hasPlaybackAuthError, hasPlaybackError, video.id]);

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
    player.pause();
    // `status` is a dependency on purpose. play() issued while the source is
    // still resolving does not always take, and without re-evaluating when
    // the player reports readyToPlay nothing ever retries - the item just
    // sits there showing its play icon until the viewer taps it. Local media
    // mostly hid this because it had a source from mount; an R2 item receives
    // its URL only after an authorization round trip, which widens the window
    // enough that the first play() regularly lands too early.
  }, [shouldPlay, hasPlaybackUrl, isInFullscreen, player, status]);

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

    // 11R remediation ADDENDUM: `true` when the currently-held authorization
    // is missing (never fetched, or cleared by a failure) or has passed its
    // own `expiresAt` - either way there is nothing playable to press "play"
    // on, and the existing behavior (silently calling `player.play()`
    // against a dead or absent source, or - once `hasPlaybackAuthError` hid
    // the button entirely - not even reaching a handler at all) is exactly
    // the "pressed play repeatedly, nothing happened" symptom from the field
    // report. Computed here rather than at render time so reading
    // `Date.now()` stays inside an event handler, never the render body.
    const needsFreshPlaybackAuthorization =
      hasPlaybackAuthError || !playbackAuth || Date.parse(playbackAuth.expiresAt) <= Date.now();

    if (needsFreshPlaybackAuthorization) {
      // Never stack a second concurrent request on top of one already in
      // flight (the debounced landing fetch, a scheduled retry, or an
      // earlier press) - a burst of taps collapses to at most one
      // outstanding request.
      if (!isPlaybackAuthRequestInFlight) {
        void requestAuthorization();
      }
      return;
    }

    setIsIndicatorVisible(true);

    if (isPlaying) {
      player.pause();
      setIsManuallyPaused(true);
      flushProgress();
      return;
    }

    player.play();
    setIsManuallyPaused(false);
  }, [
    isActive,
    hasPlaybackAuthError,
    playbackAuth,
    isPlaybackAuthRequestInFlight,
    requestAuthorization,
    isPlaying,
    player,
    flushProgress,
  ]);

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
    setIsInFullscreen(true);
    lockOrientation(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  const handleFullscreenExit = useCallback(() => {
    setIsInFullscreen(false);
    lockOrientation(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    flushProgress();
  }, [flushProgress]);

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
          // 11R remediation ADDENDUM: pressable so a failed/expired
          // authorization is reachable for a retry from here too - the
          // normal play/pause button below is hidden for this same
          // `hasPlaybackError` state, so without this the viewer had
          // nothing to press at all while it was up.
          <Pressable
            testID="feed-item-play-pause"
            accessibilityRole="button"
            onPress={handlePlayPause}
            style={styles.errorState}>
            <Text style={styles.errorTitle}>{t('feed.videoUnavailable')}</Text>
            <Text style={styles.errorHint}>{t('feed.videoUnavailableHint')}</Text>
          </Pressable>
        ) : (
          <VideoView
            contentFit={isHorizontal ? 'contain' : 'cover'}
            fullscreenOptions={{
              enable: isHorizontal,
              orientation: 'landscape',
              autoExitOnRotate: true,
            }}
            // The feed itself keeps its custom chrome, but native fullscreen
            // had `nativeControls={false}` too - which left it with no
            // controls at all, so a viewer who entered fullscreen had no
            // visible way back out and had to guess (rotating the device was
            // the only exit). Enabling the platform controls while, and only
            // while, fullscreen is active restores the standard Done/collapse
            // affordance people already know, without touching the in-feed UI.
            nativeControls={isInFullscreen}
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

      {/* Mobile UI revision (2026-08-12, updated per direct product feedback
          the same day): the title stands ALONE in the upper-left hierarchy,
          under Home's brand overlay - no description, no channel text
          ("Short Drama Mandarin" was explicitly asked to be removed), no
          badge. Tapping it keeps the existing navigation path to the series
          detail screen. */}
      <View
        testID="feed-item-title-overlay"
        pointerEvents={isClearDisplay ? 'none' : 'box-none'}
        style={[
          styles.titleOverlay,
          { top: insets.top + TITLE_OVERLAY_TOP_OFFSET },
          isWideLayout && styles.titleOverlayWide,
          isClearDisplay && styles.contentHidden,
        ]}>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/series/[id]', params: { id: video.seriesId } })
          }
          style={({ pressed }) => [pressed && styles.buttonPressed]}>
          <Text numberOfLines={2} style={[styles.title, styles.textShadow]}>
            {video.title}
          </Text>
        </Pressable>
      </View>

      {/* Right-side episode cluster (product feedback 2026-08-12): the "EP n"
          indicator lives directly BENEATH the next-episode control, not in
          the title block and never in a bottom corner. When this is the last
          episode (no next-episode control) the indicator still renders here,
          so the current episode stays identifiable - every episode of a
          series shares the same title. */}
      <View
        testID="feed-item-episode-cluster"
        pointerEvents={isClearDisplay ? 'none' : 'box-none'}
        style={[
          styles.episodeCluster,
          { top: insets.top + NEXT_EPISODE_TOP_OFFSET },
          isClearDisplay && styles.contentHidden,
        ]}>
        {nextEpisode ? (
          <Pressable
            testID="feed-item-next-episode"
            accessibilityRole="button"
            onPress={handleNextEpisode}
            style={({ pressed }) => [styles.nextEpisodeButton, pressed && styles.buttonPressed]}>
            <Text numberOfLines={1} style={styles.nextEpisodeText}>
              {t('feed.nextEpisode')}
            </Text>
          </Pressable>
        ) : null}
        <Text style={[styles.episodeIndicator, styles.textShadow]}>
          {`EP ${video.episodeNumber}`}
        </Text>
      </View>

      {/* Mobile UI revision (2026-08-12): the bottom overlay now carries the
          action rail alone - title/channel/episode metadata moved to the
          upper-left title overlay above, and the caption no longer renders
          in the feed at all (the data itself is untouched: Discover search
          and Share still read `video.caption`). */}
      <View
        testID="feed-item-bottom-overlay"
        pointerEvents={isClearDisplay ? 'none' : 'box-none'}
        style={[styles.content, { bottom: overlayBottom }, isClearDisplay && styles.contentHidden]}>
        <View testID="feed-item-actions-rail" style={styles.actions}>
          {/* Issue 3 (11R physical-QA remediation): fullscreen used to be an
              ad-hoc absolutely-positioned text pill (top-left of the item,
              independent of this rail's own bottom anchor), which was easy
              to miss and, on a physically constrained screen, competed for
              space with other absolutely-positioned overlays. Folding it in
              here gives it the same 48px hit target, the same bottom anchor,
              and the same "no interactive control overlaps another"
              guarantee every other rail action already has. Shown under the
              same condition as before - a horizontal video - so a vertical
              clip's rail is unchanged. */}
          {hasPlaybackError || !isHorizontal ? null : (
            <Pressable
              accessibilityLabel={t('feed.fullscreen')}
              accessibilityRole="button"
              onPress={handleEnterFullscreen}
              style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}>
              <SymbolView
                name={{
                  ios: 'arrow.up.left.and.arrow.down.right',
                  android: 'fullscreen',
                  web: 'fullscreen',
                }}
                size={24}
                tintColor="#fff"
                style={styles.actionIconShadow}
              />
            </Pressable>
          )}
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
                size={24}
                tintColor="#fff"
                style={styles.actionIconShadow}
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
                size={26}
                tintColor={isLiked ? Palette.primary : '#fff'}
                style={styles.actionIconShadow}
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
              size={24}
              tintColor={isSaved ? Palette.primary : '#fff'}
              style={styles.actionIconShadow}
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
              style={styles.actionIconShadow}
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
            {PLAYBACK_SPEEDS.map((speedOption) => {
              const isSelected = playbackSpeed === speedOption;

              return (
                <Pressable
                  key={speedOption}
                  accessibilityLabel={`Kecepatan ${speedOption}x`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setPlaybackSpeed(speedOption)}
                  style={({ pressed }) => [
                    styles.clearSpeedOption,
                    isSelected && styles.clearSpeedOptionSelected,
                    pressed && styles.buttonPressed,
                  ]}>
                  <Text
                    style={[styles.clearSpeedText, !isSelected && styles.clearSpeedTextDimmed]}>
                    {`${speedOption}×`}
                  </Text>
                </Pressable>
              );
            })}
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
  // Positions the next-episode control and the "EP n" indicator beneath it
  // as one right-aligned cluster; `top` is provided inline (inset-aware,
  // below the title block - see NEXT_EPISODE_TOP_OFFSET).
  episodeCluster: {
    position: 'absolute',
    right: 18,
    alignItems: 'flex-end',
    gap: 6,
  },
  // `maxWidth` is belt-and-suspenders on top of the vertical separation
  // from the title: even an unexpectedly long localized label can never
  // grow the pill across the frame (its text ellipsizes instead).
  nextEpisodeButton: {
    minWidth: 74,
    maxWidth: 180,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  episodeIndicator: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
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
  // The three speed options share the pill with play/pause; the selected
  // one carries the filled background, so the current rate reads at a
  // glance without needing a separate label.
  clearSpeedOption: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  clearSpeedOptionSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  clearSpeedText: {
    fontSize: 15,
    fontFamily: FontFamily.bold,
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  clearSpeedTextDimmed: {
    color: 'rgba(255, 255, 255, 0.55)',
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
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
  },
  // The upper-left title block. Overlap with the next-episode pill is
  // prevented VERTICALLY (the pill sits below this block's maximum extent -
  // see NEXT_EPISODE_TOP_OFFSET); `right: 112` is an aesthetic measure so a
  // long title wraps as a compact block instead of running edge-to-edge.
  titleOverlay: {
    position: 'absolute',
    left: 18,
    right: 112,
  },
  titleOverlayWide: {
    maxWidth: TITLE_MAX_WIDTH_WIDE,
  },
  textShadow: {
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
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
  // Mobile UI revision (2026-08-12, tightened per direct product feedback
  // the same day): FULLY transparent TikTok-style controls - no scrim, no
  // pill, no border, "no black element". Legibility over bright footage
  // comes from the drop shadow on the glyph itself (`actionIconShadow`
  // below). The 48px pressable is unchanged - the visual disappeared, the
  // hit target did not.
  actionButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  // iOS renders this as a soft content shadow around the glyph (the view
  // has no background, so the shadow follows the icon's alpha); Android
  // ignores shadow* props - acceptable, the primary QA target is iPhone.
  actionIconShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
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
