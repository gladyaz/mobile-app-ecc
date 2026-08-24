import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { router } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaybackSettingsSheet } from '@/components/playback-settings-sheet';
import { PremiumPreviewModal } from '@/components/premium-preview-modal';
import { AUTO_CLEAR_DISPLAY_DELAY_MS, type ClearDisplayOrigin } from '@/constants/clear-display';
import { FontFamily, Palette, Radius, Typography } from '@/constants/theme';
import { FeedProgressBar } from '@/components/feed-progress-bar';
import { useAppForeground } from '@/hooks/use-app-foreground';
import { useAssistiveTechEnabled } from '@/hooks/use-assistive-tech-enabled';
import { useAutoClearDisplayIdle } from '@/hooks/use-auto-clear-display-idle';
import { useFeedBottomAnchor } from '@/hooks/use-feed-bottom-anchor';
import { nextVideoRequestId } from '@/features/videos/video-request-id';
import {
  playbackPlayerLabel,
  reportPlaybackDecision,
  reportPlayingState,
} from '@/services/debug/playback-invariant';
import {
  acquirePlaybackOwnership,
  releasePlaybackOwnership,
} from '@/services/playback/playback-ownership';
import { useTranslation } from '@/stores/language';
import { DEFAULT_PLAYBACK_SPEED, type PlaybackSpeed } from '@/constants/playback-speed';
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
// notch/Dynamic-Island/SE-class screen.
const TITLE_OVERLAY_TOP_OFFSET = 44;

// The cap every text overlay in this component shares, matching the tab bar's
// own labels (see `(tabs)/_layout.tsx`) and Discover's poster overlays. Named
// here because three separate overlays now depend on the SAME number: an OS
// text size at 200% is what turns the two-line title into a block that reaches
// the episode cluster, and the episode row into a clipped one.
const OVERLAY_MAX_FONT_SCALE = 1.3;

// The kebab sits alone in the top-right safe area. 48 is the button's own
// size; nothing else is anchored to the top-right any more (the episode
// cluster moved to the lower-left band - see `episodeCluster`).
const OVERFLOW_TOP_OFFSET = 8;
const OVERFLOW_BUTTON_SIZE = 48;

// Product feedback (2026-08-22): the episode cluster moved out of the
// upper-right corner and into the lower-left band, directly above the bottom
// tab bar, so it reads as part of the lower navigation/content controls
// rather than as an overlay floating over the middle of the frame. Its
// vertical anchor is NOT a constant: it comes from `useFeedBottomAnchor`
// (`overlayBottom`), the same tab-bar/safe-area-derived value the action
// rail already uses, so the two sit in one band on every device and the
// cluster can never end up underneath the tab bar or the Android gesture
// area.
//
// Horizontally it is bounded on the right so it can never run under the
// action rail. The rail's own buttons are `ACTION_BUTTON_SIZE` wide and sit
// inside the bottom overlay's 18px horizontal padding; this reserves that
// column plus a further 18px of clearance between the two.
const ACTION_BUTTON_SIZE = 48;
const ACTION_RAIL_CLEARANCE = 18 + ACTION_BUTTON_SIZE + 18;

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
 * mode this ADDENDUM exists to recover from) or a genuine transport failure
 * (`ApiError` status 0, code `NETWORK_ERROR` for a refused connection or
 * `TIMEOUT` for a host that resolved and then never answered - see
 * `services/api/client.ts`) is worth automatically retrying. Every other failure - most importantly a
 * 403 `ENTITLEMENT_REQUIRED` (the viewer genuinely does not have access) -
 * is a legitimate, stable "unavailable" state: hammering it on a timer would
 * not fix it, and would just add load for nothing. `status === 0` is
 * deliberately NOT used as the network-error test on its own - a missing
 * `EXPO_PUBLIC_API_BASE_URL` also carries status 0
 * (`ApiError(0, 'MISSING_BASE_URL', ...)`), and that is a standing
 * misconfiguration, not a transient blip.
 */
function isRetryablePlaybackAuthError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 429 || error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT')
  );
}

const ENTITLEMENT_REQUIRED_ERROR_CODE = 'ENTITLEMENT_REQUIRED';
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

/**
 * What a playback-authorization REFUSAL requires of the viewer before this
 * episode could play - the two truthful narrowings of the otherwise-generic
 * "video unavailable" state.
 *
 * - `'sign-in'`: there is no usable session. Signing in is the next step.
 * - `'premium'`: there IS a session, and the backend refused it for want of
 *   an entitlement. Acquiring Premium is the next step.
 *
 * `null` (see `classifyPlaybackAccessRequirement` below) means the refusal
 * is NOT an access problem at all - a network failure, a 409 with no usable
 * media, an unparseable 200 - and keeps the generic unavailable copy.
 */
type PlaybackAccessRequirement = 'sign-in' | 'premium';

/**
 * Guest-first feed (2026-08-22) / ANONYMOUS FREE-EPISODE PLAYBACK, extended
 * by PREMIUM ENTITLEMENT ERROR UX (2026-08-22): LABELS a refusal the backend
 * has ALREADY made, for display purposes only.
 *
 * It is never consulted before a request, it never converts a refusal into
 * access, and it never runs a FREE/PREMIUM judgement of its own - it reads
 * the status/code the backend returned plus whether this viewer holds a
 * token at all, and nothing else. In particular it never looks at
 * `episodeNumber`, `accessTier`, or the client's own entitlement store
 * (`useEntitlement`): "am I premium?" according to the client must never
 * decide what a backend playback refusal MEANS, or a stale/failed
 * entitlement read would start rewriting the reason playback was blocked.
 *
 * Three cases qualify, and only these three:
 *
 * 1. Any 401 -> `'sign-in'`. The backend answers `401 INVALID_ACCESS_TOKEN`
 *    for a SUPPLIED but invalid/expired/malformed credential
 *    (`OptionalJwtAuthGuard` never downgrades one to an anonymous request),
 *    and the client's own refresh-on-401 interceptor has already consumed
 *    and retried `INVALID_ACCESS_TOKEN` before this point - so what reaches
 *    here is a 401 that survived a refresh attempt, i.e. a genuinely dead
 *    session. Deliberately NOT keyed on the error `code`, since whichever
 *    401 survives that retry may carry any code at all.
 *
 * 2. A `403 ENTITLEMENT_REQUIRED` for a viewer holding NO access token ->
 *    `'sign-in'`. Since the guard swap, this is exactly the
 *    guest-on-a-PREMIUM-episode case: the backend refused for want of an
 *    entitlement, and a guest has no account that could hold one, so the
 *    first real step is signing in - never Rewards, which a signed-out
 *    viewer cannot redeem from.
 *
 * 3. A `403 ENTITLEMENT_REQUIRED` for a viewer who DOES hold an access token
 *    -> `'premium'`. The backend returns this byte-for-byte identically to a
 *    guest's (so the response leaks nothing about who asked), which is why
 *    the token is what separates the two. Telling this viewer to "sign in"
 *    would be false - they already are - and calling it a media/network
 *    failure would be false too: the media server is healthy, the
 *    entitlement is what is missing.
 *
 * The `code` check is what keeps case 2/3 honest in the other direction: a
 * 403 carrying any OTHER code is not the canonical entitlement refusal and
 * is deliberately NOT reinterpreted as a Premium upsell.
 */
function classifyPlaybackAccessRequirement(
  error: unknown,
  accessToken: string | undefined
): PlaybackAccessRequirement | null {
  if (!(error instanceof ApiError)) {
    return null;
  }

  if (error.status === HTTP_UNAUTHORIZED) {
    return 'sign-in';
  }

  if (error.status === HTTP_FORBIDDEN && error.code === ENTITLEMENT_REQUIRED_ERROR_CODE) {
    return accessToken ? 'premium' : 'sign-in';
  }

  return null;
}

/**
 * 11R PLAYBACK-STABILITY REMEDIATION: the single-sentence "why" behind a
 * reconciler pause() call, for the dev-only decision log
 * (`reportPlaybackDecision`) - names the FIRST of `shouldPlay`'s inputs
 * that is false, in the same priority order `shouldPlay` itself is written
 * in, so the trace always matches the actual short-circuit that produced
 * the pause instead of guessing at which of several simultaneously-false
 * flags was the real cause.
 */
function describeNotPlayingReason(flags: {
  readonly hasPlaybackUrl: boolean;
  readonly isActive: boolean;
  readonly isScreenFocused: boolean;
  readonly isAppForeground: boolean;
  readonly isManuallyPaused: boolean;
  readonly adVisible: boolean;
}): string {
  if (!flags.hasPlaybackUrl) {
    return 'no-source';
  }

  if (!flags.isActive) {
    return 'inactive';
  }

  if (!flags.isScreenFocused) {
    return 'screen-unfocused';
  }

  if (!flags.isAppForeground) {
    return 'app-backgrounded';
  }

  if (flags.isManuallyPaused) {
    return 'user-paused';
  }

  if (flags.adVisible) {
    return 'ad-visible';
  }

  return 'unknown';
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
   * the next episode. `origin` says who asked: every manual entry point
   * (tap, pinch, sheet switch) omits it and defaults to 'manual'; only the
   * idle timer passes 'auto', which is what lets the owner (Home's
   * `useClearDisplayState`) un-clear an auto-hide on the next swipe while
   * manual clears keep their baseline persist-across-swipes behavior.
   */
  readonly isClearDisplay?: boolean;
  readonly onToggleClearDisplay?: (
    nextIsClearDisplay: boolean,
    origin?: ClearDisplayOrigin
  ) => void;
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
  // Whether a two-finger gesture is currently on the glass (from capture
  // until release/terminate). Real state, not a ref: the auto-clear idle
  // eligibility below must RE-EVALUATE when it changes - fingers resting on
  // the screen mid-pinch are the opposite of idle, and the chrome must
  // never vanish underneath them (review fix cycle 1, Reviewer A finding 2 /
  // Reviewer B finding M1).
  const [isPinchInProgress, setIsPinchInProgress] = useState(false);
  // Per-item, not session-scoped (product decision 2026-08-13, reversing the
  // session-wide store that had itself reversed an earlier per-clip design).
  // A rate is a way to skim THIS clip, not a standing preference: landing on
  // a fresh video already at 2x because of a choice made two clips ago is a
  // surprise, so every newly-active item starts at 1x.
  //
  // Component-local state IS the guarantee - with no shared store, one item
  // structurally cannot reach another item's rate, and the choice lives
  // exactly as long as this item stays mounted in the feed's render window.
  //
  // The rate mirror effect below still MUST keep its `shouldPlay` gate. It is
  // no longer needed to protect OTHER items (they no longer re-render on this
  // change at all), but it is still what stops a rate chosen while THIS item
  // is inactive or paused from starting its own player - on iOS a rate write
  // IS a play command.
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(DEFAULT_PLAYBACK_SPEED);
  const [isSettingsSheetVisible, setIsSettingsSheetVisible] = useState(false);
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
  const [playbackAuth, setPlaybackAuth] = useState<PlaybackAuthorization | null>(null);
  const [hasPlaybackAuthError, setHasPlaybackAuthError] = useState(false);
  // Guest-first feed (2026-08-22) / ANONYMOUS FREE-EPISODE PLAYBACK, extended
  // by PREMIUM ENTITLEMENT ERROR UX (2026-08-22): narrows the ONE generic
  // playback-failure state into the cause the viewer can actually act on -
  // "signing in is the next step" (`'sign-in'`) or "Premium is the next
  // step" (`'premium'`). `null` keeps the generic unavailable copy, which is
  // what every non-access failure (network, transport, unusable media) still
  // lands on.
  //
  // It is set ONLY from a refusal the BACKEND already returned, never ahead
  // of one, and only for the cases `classifyPlaybackAccessRequirement`
  // (above) admits.
  //
  // It grants NOTHING: no entitlement is inferred, no request is ever
  // retried without a token to get a different answer, and the client's own
  // `useEntitlement` premium flag is deliberately not consulted here. It
  // only chooses which truthful copy to render over a decision the backend
  // already made.
  const [playbackAccessRequirement, setPlaybackAccessRequirement] =
    useState<PlaybackAccessRequirement | null>(null);
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
  // 11R PLAYBACK-STABILITY REMEDIATION: whether THIS video has ever actually
  // rendered a real playing frame (a genuine `playingChange` event, not
  // merely "a play() was issued") - the one real-readiness signal the
  // poster overlay below is driven by. Reset on a video-id change using the
  // same render-time pattern as the grant reset just above, so a freshly
  // assigned video always starts poster-first even if a PREVIOUS video on
  // this same mounted instance had already started playing. Deliberately
  // NOT reset on deactivation/manual-pause/a player-generation swap (see
  // the reseek effect below) - a frame that has already been shown must
  // never be replaced by the poster again for the same video, or the
  // poster would flicker back in on every pause/swipe-away.
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);

  if (lastVideoId !== video.id) {
    setLastVideoId(video.id);
    setPlaybackAuth(null);
    setHasPlaybackAuthError(false);
    setPlaybackAccessRequirement(null);
    setAuthRetryAttempt(0);
    setIsAuthErrorRetryable(false);
    setHasStartedPlaying(false);
    // Same cheap insurance as the rest of this block: today's keyed FlatList
    // never recycles an instance across videos, but if one ever did, an
    // inherited rate is exactly the cross-video surprise the per-video
    // decision exists to prevent.
    setPlaybackSpeed(DEFAULT_PLAYBACK_SPEED);
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

    // ANONYMOUS FREE-EPISODE PLAYBACK (2026-08-22): there is deliberately NO
    // pre-request short-circuit here any more. The client used to refuse
    // outright whenever it held no access token, which made the MOBILE app
    // the authority on who may watch what - and, now that the backend
    // serves FREE episodes to guests, made it wrong: a signed-out viewer was
    // refused before the backend was ever asked, so a free episode the
    // backend would happily authorize never played.
    //
    // Every caller now ASKS. `GET /videos/:id/playback` is
    // `OptionalJwtAuthGuard`-guarded (backend `videos.controller.ts`): no
    // header at all is a valid anonymous request, and the SAME
    // `enforceEntitlementGate` decides FREE-vs-PREMIUM and entitlement for
    // guests and signed-in callers alike. The client attaches whatever token
    // it has (via `buildAuthHeader` in `services/api/client.ts`, which sends
    // no header when there is none) and consumes the answer. It classifies
    // the refusal for DISPLAY below; it never makes one.
    playbackRequestIdRef.current += 1;
    const requestId = playbackRequestIdRef.current;
    setHasPlaybackAuthError(false);
    setPlaybackAccessRequirement(null);
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
      // The backend is the authority on this, not the client. This only
      // LABELS the refusal it already made - see
      // `classifyPlaybackAccessRequirement` for the three cases that qualify
      // (a session-dead 401, a guest's 403 ENTITLEMENT_REQUIRED, and a
      // SIGNED-IN viewer's 403 ENTITLEMENT_REQUIRED). A premium refusal is
      // never re-labelled as a login problem for someone who is already
      // logged in, and a network/transport failure is never re-labelled as a
      // premium upsell.
      setPlaybackAccessRequirement(classifyPlaybackAccessRequirement(requestError, accessToken));
      setIsAuthErrorRetryable(isRetryablePlaybackAuthError(requestError));
    } finally {
      if (playbackRequestIdRef.current === requestId) {
        setIsPlaybackAuthRequestInFlight(false);
        isPlaybackAuthRequestInFlightRef.current = false;
      }
    }
  }, [video.id, accessToken]);

  // 11R remediation ADDENDUM (fix cycle 2, Finding 1): a request left
  // outstanding by the PREVIOUS `requestAuthorization` identity (i.e. for
  // the previous video.id/accessToken generation) must never block the
  // FIRST request of a NEW one - that old request is
  // already destined to be ignored on arrival via the `playbackRequestIdRef`
  // staleness check above, which is what lets a genuinely newer request
  // supersede it instead of the two racing. Without this reset, the
  // in-flight guard added above would (incorrectly) treat that now-stale
  // pending request as still blocking, silently dropping the new
  // generation's own first fetch. `requestAuthorization` is only recreated
  // when one of its two deps actually changes, so this deliberately does
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
  //     that was meant to stay silent. A rate chosen while this item is
  //     inactive or paused is held in its own local state and applied by
  //     this same effect once the item becomes eligible again.
  //   - the equality check keeps a re-render from re-issuing an identical
  //     write, since even that would restart a paused player.
  //
  // Now that the rate is per-item, a newly-active item holds the default 1
  // while its fresh player already reports 1, so the equality check elides the
  // write entirely: activating a default-speed item issues NO rate write at
  // all. That is strictly safer than the session-scoped predecessor, which
  // wrote the inherited rate on every activation. The effect still re-runs on
  // a player-generation swap (`player` is a dep), so an item that IS at 1.5x
  // re-applies it to the replacement player - the rate survives a token
  // refresh without surviving into the next video.
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
      // Ownership is given up FIRST, outside the try below: it is a plain
      // bookkeeping call that cannot throw, whereas everything inside the try
      // touches the native object (`player.status`, `player.pause()`) and can
      // throw once it has been released. Releasing after those would mean a
      // torn-down player could stay on record as the playback owner.
      releasePlaybackOwnership(player);

      try {
        // `player.status` (the player's own synchronous property), not the
        // `status` returned by the `statusChange` useEvent hook below - that
        // hook is declared after this effect, and its live value is more
        // accurate here anyway (this cleanup can fire asynchronously, well
        // after the render that closed over the React-state value).
        reportPlaybackDecision(playerLabel, video.id, 'pause', 'outgoing-player-generation-replaced', {
          isActive,
          isScreenFocused,
          isAppForeground,
          isManuallyPaused,
          sourceKind: playbackAuth?.kind ?? 'none',
          playerStatus: player.status,
        });
        player.pause();
      } catch {
        // On native the shared object can already be released by the time
        // this runs during teardown; there is nothing left to pause then.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status, error } = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });
  // Reconciliation fix (Reviewer A, HIGH 1): `useEvent` state SURVIVES a
  // player swap - it only re-subscribes to the new emitter, it never resets -
  // so at the commit that hands back a replacement player, `status` above
  // still holds the OUTGOING generation's last event (typically
  // 'readyToPlay' for a clip that was playing). Anything that needs "is THIS
  // player ready" at a generation boundary must read the live property
  // instead. Computed during render (this file already reads
  // `player.duration`/`player.currentTime` at render) so the reseek effect
  // below re-evaluates on the render each real statusChange event causes,
  // without trusting the possibly-stale event payload itself.
  const isCurrentPlayerReady = player.status === 'readyToPlay';

  // 11R PLAYBACK-STABILITY REMEDIATION: the reconciler above already commits
  // to playing (issues play()) the instant `shouldPlay` turns true, but the
  // native player does not report `isPlaying: true` until it has actually
  // started decoding frames - buffering, the cold-open authorization round
  // trip, and a first-frame decode all sit inside this gap. Without this
  // distinction the tap-to-play indicator below rendered its PLAY glyph
  // (built to mean "paused, tap to resume") for the ENTIRE gap, which is
  // exactly the "frame appears but the player is visibly PAUSED" / "delayed
  // autoplay" field report - the system had already committed to playing;
  // nothing was actually paused, and nothing needed a tap. `shouldPlay` (not
  // e.g. `status === 'loading'`) is the right predicate: it is already the
  // one true "the system intends to play this" signal, and it flips back to
  // false the instant a real reason to stop exists (inactive, backgrounded,
  // unfocused, an ad, or an explicit user pause) - at which point this
  // correctly stops representing "buffering" and the indicator is once again
  // the genuine "tap to resume" affordance.
  const isWaitingToStartPlayback = shouldPlay && !isPlaying;

  // ===== AUTO CLEAR DISPLAY ON IDLE ==================================
  // Purely presentational: the countdown's only output is
  // `onToggleClearDisplay(true, 'auto')` - the exact state change a manual
  // tap already performs - so it can never touch the player, the source,
  // authorization, position, or speed by construction.
  const isAssistiveTechEnabled = useAssistiveTechEnabled();

  // Bumped by meaningful chrome interactions (the action rail) so "the
  // viewer is actively using the controls" restarts the countdown. Play/
  // pause, the kebab, the sheet, fullscreen and clear-display taps all
  // already flip one of the eligibility inputs below, which is its own
  // cancel-and-restart - only interactions that leave eligibility unchanged
  // need the nonce.
  const [chromeInteractionNonce, setChromeInteractionNonce] = useState(0);

  const noteChromeInteraction = useCallback(() => {
    setChromeInteractionNonce((current) => current + 1);
  }, []);

  // Auto-hide may run ONLY while every one of these holds:
  // - `shouldPlay`: the one authoritative playback predicate - already
  //   folds in active item, screen focus, app foreground, no manual pause,
  //   no interstitial ad, and a real playable source.
  // - `isPlaying`: the player has genuinely confirmed frames are advancing,
  //   so buffering/cold-start (where controls matter) never counts as idle,
  //   and neither does any paused state (isPlaying is false there).
  // - `status !== 'error'` (Reviewer A, fix cycle 1): an AUTH failure is
  //   covered transitively (it nulls the source, so shouldPlay is false),
  //   but a mid-stream PLAYER error on an already-valid source is only
  //   covered if `isPlaying` flips false in lockstep with it - an event-
  //   ordering assumption, not an invariant. Stating the error condition
  //   directly removes the assumption: error UI never idles away.
  // - chrome is visible, and no sheet/modal/fullscreen owns the screen.
  // - no in-progress pinch (Reviewer A+B, fix cycle 1): two fingers
  //   resting on the glass mid-gesture are the OPPOSITE of idle - the
  //   chrome must never vanish under a held, not-yet-committed pinch.
  // - no detected assistive tech: a passive timer must never yank the
  //   control an assistive user is focused on (see useAssistiveTechEnabled).
  const isAutoClearDisplayEligible =
    shouldPlay &&
    isPlaying &&
    status !== 'error' &&
    !isClearDisplay &&
    !isSettingsSheetVisible &&
    !isPremiumModalVisible &&
    !isInFullscreen &&
    !isPinchInProgress &&
    !isAssistiveTechEnabled;

  const handleAutoClearDisplay = useCallback(() => {
    onToggleClearDisplay?.(true, 'auto');
  }, [onToggleClearDisplay]);

  useAutoClearDisplayIdle({
    isEligible: isAutoClearDisplayEligible,
    delayMs: AUTO_CLEAR_DISPLAY_DELAY_MS,
    interactionNonce: chromeInteractionNonce,
    onAutoHide: handleAutoClearDisplay,
  });
  // ===== end auto clear display on idle ==============================

  // 11R PLAYBACK-STABILITY REMEDIATION: flips exactly once per video (see
  // the `hasStartedPlaying` reset above) the first time a real
  // `playingChange` event confirms frames are actually advancing - the
  // poster overlay below is removed on this transition and never shown
  // again for the same video, so a later manual pause, deactivation, or
  // player-generation swap (the proactive-refresh reseek effect above)
  // leaves the last real frame on screen instead of replacing it with the
  // poster. Adjusted during render, the same "reset/derive state from a
  // changed input" pattern `wasActive`/`lastVideoId` already use above (not
  // a `useEffect`, which would call `setXxx` synchronously in the effect
  // body - `react-hooks/set-state-in-effect`) - and self-terminating: once
  // `hasStartedPlaying` is true this condition is false on every later
  // render until `video.id` resets it, so it can never loop.
  if (isPlaying && !hasStartedPlaying) {
    setHasStartedPlaying(true);
  }

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
  // PREMIUM ENTITLEMENT ERROR UX (2026-08-22): whether the CURRENT failure is
  // an ACCESS gate (the backend refused this viewer) rather than a media or
  // network one. Paired with `hasPlaybackError` so a stale requirement can
  // never outlive the failure that produced it: a `status === 'error'` from
  // the player alone is never an access gate, and a resolved authorization
  // clears the requirement at request start.
  const accessRequirement = hasPlaybackError ? playbackAccessRequirement : null;
  const isPlaybackAccessGated = accessRequirement !== null;
  const isSignInRequiredForPlayback = accessRequirement === 'sign-in';
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

  // 11R PLAYBACK-STABILITY REMEDIATION: continuously mirrors the player's
  // own reported position into a ref (cheap, no re-render) so the
  // generation-swap effect just below always has a fresh "where was this
  // video, a moment ago" value to restore, without itself depending on
  // `playbackPositionSeconds` (which would re-run that effect on every
  // ~250ms timeUpdate tick for no reason).
  const lastKnownPositionRef = useRef(0);

  useEffect(() => {
    lastKnownPositionRef.current = playbackPositionSeconds;
  }, [playbackPositionSeconds]);

  // Root cause of the "while playing calmly, video sometimes pauses by
  // itself then resumes" field report: `useVideoPlayer` (expo-video) hands
  // back a BRAND NEW native player - starting at position 0 - the moment its
  // resolved source's bytes actually differ, which happens on every
  // legitimate mid-playback authorization refresh (HIGH-1's proactive
  // pre-expiry refresh above; a background access-token rotation changing
  // the `Authorization` header on a `requiresAuthHeader` source has the same
  // effect). The existing outgoing-player cleanup effect already pauses the
  // OLD instance correctly (see below), but nothing seeded the NEW one with
  // the OLD one's position - so a viewer watching calmly saw their clip
  // silently jump back to 0 and re-buffer mid-scene, reading exactly like an
  // unprompted pause/restart.
  //
  // Generation-safe by construction: `previousPlayerRef` only ever advances
  // to a real, already-`readyToPlay` player (see the early return below), so
  // this can never fire twice for the same swap, never fires for the FIRST
  // real player a video ever gets (nothing to restore yet - `current` is
  // still `null`), and is reset to a clean slate on every `video.id` change
  // (the effect immediately below) so a genuinely NEW video can never be
  // seeded with the PREVIOUS video's position.
  const previousPlayerRef = useRef<typeof player | null>(null);

  // A genuinely NEW video must never inherit the PREVIOUS video's last known
  // position or player identity - only a player swap for the SAME video
  // (the effect below) is a restore-position case. Declared BEFORE that
  // effect on purpose: `video.id` changing and a player-identity change both
  // land in the SAME commit (a new video's grant reset already nulls the
  // source in the same render pass - see the `lastVideoId` reset above), and
  // React fires same-commit effects in declaration order, so this reset must
  // run first or the swap-check below would still see the PREVIOUS video's
  // now-stale `previousPlayerRef`/`lastKnownPositionRef` and misfire a seek
  // on the new video's own transient placeholder player.
  // Reconciliation fix (Reviewer A, HIGH 1): the position a generation swap
  // must restore, captured AT THE SWAP COMMIT and applied only once the
  // INCOMING player itself reports readyToPlay. The old single effect gated
  // on the `status` returned by `useEvent`, which still holds the OUTGOING
  // generation's 'readyToPlay' at the swap commit (see `isCurrentPlayerReady`
  // above) - so on iOS the seek was issued while the new player's source was
  // still loading. `seekBy` there goes straight to `AVPlayer.seek`,
  // bypassing expo-video's while-replacing deferral store, and the AVPlayer
  // has no current item yet - the seek was silently lost, the effect
  // advanced `previousPlayerRef` anyway, and the clip restarted at 0:00:
  // exactly the mid-playback reset this code exists to prevent.
  const pendingGenerationRestoreSecondsRef = useRef(0);

  useEffect(() => {
    previousPlayerRef.current = null;
    lastKnownPositionRef.current = 0;
    pendingGenerationRestoreSecondsRef.current = 0;
  }, [video.id]);

  // DETECT half: runs exactly once per player identity, in the SAME commit
  // as the swap - capturing where the SAME video was a moment ago BEFORE the
  // incoming player can emit its own near-zero timeUpdates over
  // `lastKnownPositionRef`. Never fires for the FIRST real player a video
  // gets (`previousPlayerRef` is still null then), and the video-id reset
  // above (declared first, so it runs first within this commit) guarantees a
  // genuinely NEW video can never capture the PREVIOUS video's position.
  useEffect(() => {
    const isGenerationSwapForSameVideo =
      previousPlayerRef.current !== null && previousPlayerRef.current !== player;

    if (isGenerationSwapForSameVideo && lastKnownPositionRef.current > 0) {
      pendingGenerationRestoreSecondsRef.current = lastKnownPositionRef.current;
    }

    previousPlayerRef.current = player;
  }, [player]);

  // APPLY half: consumes the pending restore the first time the INCOMING
  // player is genuinely ready. `isCurrentPlayerReady` is the live
  // `player.status` sampled at render - each real statusChange event causes
  // a render, so this re-evaluates on the incoming player's own readiness
  // and never on the stale event snapshot. Consumed exactly once: the ref is
  // zeroed before seeking, so later re-runs (renders, prop churn) are no-ops.
  useEffect(() => {
    if (pendingGenerationRestoreSecondsRef.current <= 0 || !isCurrentPlayerReady) {
      return;
    }

    const restoreSeconds = pendingGenerationRestoreSecondsRef.current;

    pendingGenerationRestoreSecondsRef.current = 0;
    reportPlaybackDecision(playerLabel, video.id, 'source-replace', 'generation-swap-reseek', {
      isActive,
      isScreenFocused,
      isAppForeground,
      isManuallyPaused,
      sourceKind: playbackAuth?.kind ?? 'none',
      playerStatus: player.status,
    });
    player.seekBy(restoreSeconds - player.currentTime);
  }, [
    player,
    isCurrentPlayerReady,
    playerLabel,
    video.id,
    isActive,
    isScreenFocused,
    isAppForeground,
    isManuallyPaused,
    playbackAuth,
  ]);

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
        // Ordered handoff, BEFORE play(): React commits passive effects in
        // tree order, so on a BACKWARD swipe this item's effect runs before
        // the outgoing item's own pause effect. Acquiring here pauses
        // whoever currently owns playback first, so the two players are
        // never both commanded to play - regardless of which one React
        // happened to reach first. See services/playback/playback-ownership.
        acquirePlaybackOwnership(player, () => {
          try {
            player.pause();
          } catch {
            // The shared native object can already be released by the time a
            // superseded generation is asked to relinquish playback; there is
            // nothing left to pause then. Never rethrow: this runs INSIDE the
            // incoming player's acquire, and must not stop it from starting.
          }
        });
        reportPlaybackDecision(playerLabel, video.id, 'play', 'shouldPlay:true', {
          isActive,
          isScreenFocused,
          isAppForeground,
          isManuallyPaused,
          sourceKind: playbackAuth?.kind ?? 'none',
          playerStatus: status,
        });
        player.play();
      }
      return;
    }

    reportPlaybackDecision(
      playerLabel,
      video.id,
      'pause',
      describeNotPlayingReason({
        hasPlaybackUrl,
        isActive,
        isScreenFocused,
        isAppForeground,
        isManuallyPaused,
        adVisible,
      }),
      {
        isActive,
        isScreenFocused,
        isAppForeground,
        isManuallyPaused,
        sourceKind: playbackAuth?.kind ?? 'none',
        playerStatus: status,
      }
    );
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
    //
    // Released BEFORE the pause, and a no-op if an incoming player has
    // already taken ownership - so an outgoing item settling late can never
    // leave the feed ownerless while the incoming player is legitimately
    // playing.
    releasePlaybackOwnership(player);
    player.pause();
    // `status` is a dependency on purpose. play() issued while the source is
    // still resolving does not always take, and without re-evaluating when
    // the player reports readyToPlay nothing ever retries - the item just
    // sits there showing its play icon until the viewer taps it. Local media
    // mostly hid this because it had a source from mount; an R2 item receives
    // its URL only after an authorization round trip, which widens the window
    // enough that the first play() regularly lands too early.
    //
    // 11R PLAYBACK-STABILITY REMEDIATION: `describeNotPlayingReason`'s inputs
    // (isActive/isScreenFocused/isAppForeground/isManuallyPaused/adVisible)
    // and the extra `reportPlaybackDecision` context fields
    // (playerLabel/video.id/playbackAuth) are read here ONLY to label the
    // dev-only decision log - they are already folded into `shouldPlay`
    // itself, which IS a dependency. Listing them again would make this,
    // the one authoritative reconciler, re-run on every log-only change
    // (e.g. a `playbackAuth` object identity change that does not actually
    // change `shouldPlay`), which is exactly the "additional churn" this
    // remediation exists to remove, not add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      reportPlaybackDecision(playerLabel, video.id, 'pause', 'user-tap', {
        isActive,
        isScreenFocused,
        isAppForeground,
        isManuallyPaused: true,
        sourceKind: playbackAuth?.kind ?? 'none',
        playerStatus: status,
      });
      releasePlaybackOwnership(player);
      player.pause();
      setIsManuallyPaused(true);
      flushProgress();
      return;
    }

    reportPlaybackDecision(playerLabel, video.id, 'play', 'user-tap', {
      isActive,
      isScreenFocused,
      isAppForeground,
      isManuallyPaused: false,
      sourceKind: playbackAuth?.kind ?? 'none',
      playerStatus: status,
    });
    acquirePlaybackOwnership(player, () => {
      try {
        player.pause();
      } catch {
        // Same contract as the reconciler's own release handler above.
      }
    });
    player.play();
    setIsManuallyPaused(false);
  }, [
    isActive,
    isScreenFocused,
    isAppForeground,
    hasPlaybackAuthError,
    playbackAuth,
    isPlaybackAuthRequestInFlight,
    requestAuthorization,
    isPlaying,
    player,
    playerLabel,
    video.id,
    status,
    flushProgress,
  ]);

  const handleEnterFullscreen = useCallback(() => {
    void videoViewRef.current?.enterFullscreen();
  }, []);

  const handleOpenSettingsSheet = useCallback(() => setIsSettingsSheetVisible(true), []);
  const handleCloseSettingsSheet = useCallback(() => setIsSettingsSheetVisible(false), []);

  // The sheet's Clear Display switch drives the SAME lifted state as the
  // single tap and the pinch - one implementation, three entry points. The
  // sheet closes on toggle so the result is immediately visible.
  const handleToggleClearDisplayFromSheet = useCallback(() => {
    setIsSettingsSheetVisible(false);
    onToggleClearDisplay?.(!isClearDisplay);
  }, [isClearDisplay, onToggleClearDisplay]);

  // Fullscreen keeps the baseline implementation untouched - only its entry
  // point moved from the action rail into the sheet. On iOS, presenting the
  // native fullscreen view controller while the sheet Modal is still
  // animating out is a UIKit presentation conflict, so the call is deferred
  // to the Modal's onDismiss (which fires only after that transition ends,
  // and only exists on iOS). Other platforms enter immediately.
  const pendingFullscreenRef = useRef(false);

  const handleEnterFullscreenFromSheet = useCallback(() => {
    setIsSettingsSheetVisible(false);

    if (Platform.OS === 'ios') {
      pendingFullscreenRef.current = true;
      return;
    }

    handleEnterFullscreen();
  }, [handleEnterFullscreen]);

  // Idle-countdown note (review fix cycle 1, both reviewers' LOW): between
  // the sheet closing and iOS fullscreen actually engaging, eligibility is
  // briefly true and a fresh idle timer arms. Harmless by arithmetic: the
  // Modal dismiss animation (low hundreds of ms) is far shorter than
  // AUTO_CLEAR_DISPLAY_DELAY_MS (3000ms), and the moment fullscreen engages
  // `isInFullscreen` suspends the countdown again. If that delay were ever
  // reduced near typical animation durations, revisit this window.
  const handleSettingsSheetDismissed = useCallback(() => {
    if (!pendingFullscreenRef.current) {
      return;
    }

    pendingFullscreenRef.current = false;

    // The item can lose the active slot during the Modal's dismissal
    // transition. Presenting fullscreen for a video that is no longer active
    // would not self-correct, because the reconciler abstains entirely while
    // `isInFullscreen` is true.
    if (!isActiveRef.current) {
      return;
    }

    handleEnterFullscreen();
  }, [handleEnterFullscreen]);

  // If playback errors while the sheet is open the sheet unmounts (see the
  // render gate), so drop the flag too - otherwise a later error-recovery
  // render would resurrect a sheet nobody asked for.
  useEffect(() => {
    if (hasPlaybackError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsSettingsSheetVisible(false);
      pendingFullscreenRef.current = false;
    }
  }, [hasPlaybackError]);

  const handleNextEpisode = useCallback(() => {
    // Only the ACTIVE item may navigate, mirroring `handlePlayPause`'s own
    // guard and for the same reason: a tap can land on a mounted-but-
    // inactive neighbour (reachable on web, and during a mid-swipe layout).
    // That mattered less while this control sat in the upper-right corner;
    // it matters now that it sits in the lower band where a thumb already
    // is. Without it, one gesture could navigate away using a NEIGHBOUR's
    // series - an accidental jump, from the wrong episode.
    if (!isActive) {
      return;
    }

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
  }, [isActive, nextEpisode, isPremium, video.seriesId]);

  const handleGoToFreeEpisode = useCallback(() => {
    setIsPremiumModalVisible(false);

    if (firstFreeEpisodeInSeries) {
      // Same feed-route contract as a Series Detail episode row: the id is the
      // target, the request id marks this as its own selection.
      router.push({
        pathname: '/',
        params: {
          videoId: firstFreeEpisodeInSeries.videoId,
          videoRequestId: nextVideoRequestId(),
        },
      });
    }
  }, [firstFreeEpisodeInSeries]);

  // Guest-first feed (2026-08-22): the EXISTING login entry point (the same
  // `/login` route profile.tsx pushes), reached from the one place a
  // signed-out viewer actually hits the wall. Pushed, not replaced, so the
  // feed is still behind it and backing out returns to browsing - a guest
  // may decline and keep scrolling indefinitely. Nothing here creates an
  // account or signs anyone in.
  const handleGoToLogin = useCallback(() => {
    router.push('/login');
  }, []);

  // PREMIUM ENTITLEMENT ERROR UX (2026-08-22): the EXISTING Rewards route -
  // by route IDENTITY (`/rewards`, the `(tabs)/rewards.tsx` screen), never by
  // tab index or position, so moving Rewards to a different slot in the tab
  // bar cannot break this CTA.
  //
  // Rewards is where Premium is actually acquired today (redemption debits
  // points and grants the entitlement server-side - see
  // `features/rewards/use-rewards-center.ts`), so it is the honest
  // destination for a signed-in viewer who lacks it. There is no checkout to
  // invent, and nothing here redeems anything: this only OPENS the surface,
  // and the viewer chooses whether to spend their points.
  //
  // Pushed, not replaced, for the same reason the sign-in gate pushes: the
  // feed stays underneath, so declining returns to browsing.
  const handleGoToRewards = useCallback(() => {
    router.push('/rewards');
  }, []);

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
        setIsPinchInProgress(true);

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

        setIsPinchInProgress(true);

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
        setIsPinchInProgress(false);
      }}
      onResponderTerminate={() => {
        pinchStartDistanceRef.current = 0;
        setIsPinchInProgress(false);
      }}
      // Reconciliation fix (Reviewer A, MEDIUM 2): the capture handlers above
      // latch `isPinchInProgress` during responder NEGOTIATION, but the grant
      // can be DENIED - two fingers landing while the enclosing FlatList is
      // mid-drag is the everyday case: a ScrollView that has observed
      // scrolling refuses the termination request, so this view never becomes
      // responder and neither release nor terminate ever fires here. RN
      // reports that denial as onResponderReject; without this reset the
      // latch stayed true for the rest of the item's mounted life, silently
      // disabling the idle auto-clear countdown for the episode.
      onResponderReject={() => {
        pinchStartDistanceRef.current = 0;
        setIsPinchInProgress(false);
      }}>
      <View style={styles.videoLayer}>
        {isPlaybackAccessGated ? (
          // PREMIUM ENTITLEMENT ERROR UX (2026-08-22): an ACCESS refusal
          // renders its gate in the dedicated layer further down (after the
          // clear-display surface), not here - so this leaves the frame
          // black and hands the explanation to that layer. Deliberately NOT
          // the tap-to-retry Pressable below either: retrying the identical
          // request with the identical credential cannot produce a different
          // answer, so the actionable control is the one that can.
          null
        ) : hasPlaybackError ? (
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
          <>
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
              // visible way back out and had to guess (rotating the device
              // was the only exit). Enabling the platform controls while,
              // and only while, fullscreen is active restores the standard
              // Done/collapse affordance people already know, without
              // touching the in-feed UI.
              nativeControls={isInFullscreen}
              onFullscreenEnter={handleFullscreenEnter}
              onFullscreenExit={handleFullscreenExit}
              player={player}
              playsInline
              ref={videoViewRef}
              style={styles.video}
            />
            {/* 11R PLAYBACK-STABILITY REMEDIATION: replaces the cold-open
                black screen with the video's own thumbnail - real content,
                not an empty frame - for exactly as long as no real frame has
                ever been shown for THIS video (`hasStartedPlaying`, flipped
                by a genuine `playingChange` event, never a timer). Sits on
                top of the VideoView (declared after it, RN's default paint
                order) so it disappears in a single step the instant real
                playback is confirmed, rather than the two of them racing to
                paint over each other. */}
            {hasStartedPlaying ? null : (
              <Image
                testID="feed-item-poster"
                contentFit={isHorizontal ? 'contain' : 'cover'}
                pointerEvents="none"
                source={{ uri: video.thumbnailUrl }}
                style={styles.poster}
              />
            )}
          </>
        )}
      </View>

      {/* SINGLE TAP -> toggle clear display. Declared FIRST among the
          overlays, so RN's paint order puts it underneath every interactive
          control: the centre play/pause button, the kebab, the episode
          cluster and the action rail all win the touch when they are
          visible, and this surface only ever receives taps on otherwise open
          video. In clear display, where all of those are gone, it is the
          whole screen - which is what makes a tap the way back.

          WHY THIS DOES NOT BREAK PAGING: a Pressable claims the responder
          only on touch-START. The moment the finger moves, the enclosing
          FlatList wins it through onMoveShouldSetResponderCapture, so a
          vertical swipe still pages and never registers as a tap. Two-finger
          pinch is likewise unaffected - the container's capture handlers
          above return true only for exactly two touches, and capture runs
          before this child is offered the gesture at all.

          NOT rendered in the plain error state. The error view is its own
          Pressable (the 11R ADDENDUM's tap-to-retry re-authorization path),
          and this surface is a LATER root sibling with no zIndex - which
          makes it topmost in both platforms' hit tests and would swallow
          every retry tap, reproducing the exact "pressed play repeatedly,
          nothing happened" report that ADDENDUM was written to fix. It is
          still rendered when the error coincides with clear display, so
          hidden chrome always has a way back - recovery there is two taps
          (exit clear display, then retry), which is deliberate: the
          alternative is a failed video with no way back to its own chrome.

          PREMIUM ENTITLEMENT ERROR UX (2026-08-22) carves out exactly one
          exception, and only for an ACCESS gate: the gate layer declared
          immediately below is a LATER sibling still, so it - and only it -
          sits above this surface. Everything else here is unchanged, and
          `box-none` on that layer means the frame AROUND the gate keeps
          reaching this surface, so the way back to hidden chrome survives. */}
      {hasPlaybackError && !isClearDisplay ? null : (
        <Pressable
          testID="feed-item-clear-display-surface"
          accessibilityLabel={isClearDisplay ? t('feed.showControls') : t('feed.hideControls')}
          accessibilityRole="button"
          // While the chrome is up this full-bleed surface stays OUT of the
          // screen-reader order, or it would be the first stop on every feed
          // item, ahead of Like/Save/Share. Once the chrome is hidden it
          // becomes the accessible way to bring it back.
          accessible={isClearDisplay}
          importantForAccessibility={isClearDisplay ? 'yes' : 'no'}
          onPress={() => onToggleClearDisplay?.(!isClearDisplay)}
          style={styles.clearDisplaySurface}
        />
      )}

      {/* PREMIUM ENTITLEMENT ERROR UX (2026-08-22): the authorization gate is
          an UNAVAILABLE/ACCESS state, not playback chrome, so Clear Display
          must never be able to hide - or sit on top of - the only
          explanation for why this episode will not play, nor the only
          control that can do anything about it.

          That is exactly why this is a ROOT-LEVEL sibling declared AFTER the
          full-bleed clear-display surface above rather than a child of the
          video layer, where it used to live: RN paints (and hit-tests) later
          siblings on top, so from inside the video layer the surface
          swallowed every tap on the gate's CTA whenever the two coincided.
          `box-none` keeps the REST of the frame belonging to that surface,
          so the existing "tap anywhere to bring the chrome back" behaviour
          for other chrome is untouched - only the gate itself is carved out.

          Both gates live here because both are the same kind of state: the
          backend refused THIS viewer, and there is one truthful next step.
          Which one renders is decided by `classifyPlaybackAccessRequirement`
          from the backend's own answer - never by the client's entitlement
          flag, and never by `accessTier`/`episodeNumber`. */}
      {isPlaybackAccessGated ? (
        <View pointerEvents="box-none" style={styles.accessGateLayer}>
          {isSignInRequiredForPlayback ? (
            // ANONYMOUS FREE-EPISODE PLAYBACK (2026-08-22): a signed-out
            // viewer now reaches the feed, the metadata, the poster, the
            // whole action rail AND free playback itself - so this gate is
            // not "playback needs a session." It is the narrower, truthful
            // thing it is reachable for: THIS episode was refused, and
            // signing in is the next step (a guest's premium refusal, or a
            // session that has genuinely died). Free episodes never render
            // it at all, because they never fail.
            //
            // A guest is deliberately NOT sent to Rewards: there is nothing
            // to redeem from without an account, so sign-in comes first.
            <View testID="feed-item-signin-gate" style={styles.errorState}>
              <Text accessibilityRole="header" style={styles.errorTitle}>
                {t('feed.signInToPlay')}
              </Text>
              <Text style={styles.errorHint}>{t('feed.signInToPlayHint')}</Text>
              <Pressable
                testID="feed-item-signin-button"
                accessibilityRole="button"
                accessibilityLabel={t('feed.signIn')}
                onPress={handleGoToLogin}
                style={({ pressed }) => [styles.signInButton, pressed && styles.buttonPressed]}>
                <Text style={styles.signInButtonText}>{t('feed.signIn')}</Text>
              </Pressable>
            </View>
          ) : (
            // The signed-in, non-entitled viewer. Everything here is true of
            // them and of nobody else: they are already signed in (so "sign
            // in" would be false), and the media server is healthy (so
            // "check the media server connection" would be false too) - the
            // entitlement is the only thing missing, and Rewards is where it
            // is actually obtainable today.
            <View testID="feed-item-premium-required-gate" style={styles.errorState}>
              <Text
                testID="feed-item-premium-required-title"
                accessibilityRole="header"
                style={styles.errorTitle}>
                {t('feed.premiumRequired')}
              </Text>
              <Text style={styles.errorHint}>{t('feed.premiumRequiredHint')}</Text>
              <Pressable
                testID="feed-item-premium-required-action"
                accessibilityRole="button"
                accessibilityLabel={t('feed.openRewards')}
                // Names the DESTINATION, so a screen-reader user knows where
                // the button goes before pressing it - and that pressing it
                // spends nothing on its own.
                accessibilityHint={t('feed.premiumRequiredActionHint')}
                onPress={handleGoToRewards}
                style={({ pressed }) => [styles.signInButton, pressed && styles.buttonPressed]}>
                <Text style={styles.signInButtonText}>{t('feed.openRewards')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {hasPlaybackError || isClearDisplay ? null : (
        <Pressable
          testID="feed-item-play-pause"
          // The clear-display control strip used to be the only thing that
          // labelled play/pause; with that gone, the label belongs on the
          // control itself. An unlabelled primary playback button is a real
          // screen-reader defect, not a test detail.
          accessibilityLabel={isPlaying ? t('feed.pause') : t('feed.play')}
          accessibilityRole="button"
          onPress={handlePlayPause}
          style={({ pressed }) => [styles.playPauseButton, pressed && styles.buttonPressed]}>
          {/* 11R PLAYBACK-STABILITY REMEDIATION: `!isWaitingToStartPlayback`
              is what stops this glyph - built to mean "paused, tap to
              resume" - from rendering while the system has already
              committed to playing and is merely buffering/starting (the
              "frame appears but the player is visibly PAUSED" / "delayed
              autoplay" field report). The poster above already carries the
              screen during that window; once real playback is confirmed
              (`isPlaying`), this briefly shows the pause glyph as
              confirmation and auto-hides (unchanged, below). Whenever
              playback is genuinely NOT intended (inactive, unfocused,
              backgrounded, an ad, or an explicit user pause -
              `isWaitingToStartPlayback` is false in every one of those
              states because `shouldPlay` is already false), this still
              shows the real "tap to resume" affordance exactly as before. */}
          {isIndicatorVisible && !isWaitingToStartPlayback ? (
            <View testID="feed-item-play-pause-indicator" style={styles.playPauseCircle}>
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
        // Review fix cycle 1 (Reviewer B, C1): opacity 0 + pointerEvents
        // 'none' hides chrome from SIGHT and TOUCH but not from
        // VoiceOver/TalkBack - without these two props, clear display left
        // invisible-but-focusable ghost controls in the accessibility tree
        // (same pattern the sheet already uses for its redundant Switch).
        accessibilityElementsHidden={isClearDisplay}
        importantForAccessibility={isClearDisplay ? 'no-hide-descendants' : 'auto'}
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
          <Text
            maxFontSizeMultiplier={OVERLAY_MAX_FONT_SCALE}
            numberOfLines={2}
            style={[styles.title, styles.textShadow]}>
            {video.title}
          </Text>
        </Pressable>
      </View>

      {/* Vertical-kebab overflow: the single discoverable entry point to
          Playback Settings, replacing the long-press quick-actions menu that
          nothing advertised. Sits in the top-right safe area, above the
          episode cluster. Chrome, so it hides with everything else in clear
          display - where a single tap brings it all back. */}
      {hasPlaybackError || isClearDisplay ? null : (
        <Pressable
          testID="feed-item-playback-settings"
          accessibilityLabel={t('feed.openPlaybackSettings')}
          accessibilityRole="button"
          accessibilityState={{ expanded: isSettingsSheetVisible }}
          onPress={handleOpenSettingsSheet}
          style={({ pressed }) => [
            styles.overflowButton,
            { top: insets.top + OVERFLOW_TOP_OFFSET },
            pressed && styles.buttonPressed,
          ]}>
          {/* Drawn as three stacked dots rather than a glyph name, so it can
              never resolve to a HORIZONTAL ellipsis on any platform. */}
          <View style={styles.overflowKebab} testID="feed-item-kebab-vertical">
            <View style={styles.overflowKebabDot} />
            <View style={styles.overflowKebabDot} />
            <View style={styles.overflowKebabDot} />
          </View>
        </Pressable>
      )}

      {/* Lower-left episode cluster (product feedback 2026-08-22): "EP n" and
          the next-episode control moved out of the upper-right corner and
          down into the lower control band, reading left to right as
          `EP n  Episode Berikutnya` directly above the bottom tab bar. It
          shares the action rail's own `overlayBottom` anchor
          (`useFeedBottomAnchor`), so it is tab-bar- and safe-area-aware by
          construction rather than by a device-specific number, and it is
          bounded on the right by `ACTION_RAIL_CLEARANCE` so it can never run
          under the rail. When this is the last episode (no next-episode
          control) the indicator still renders here, so the current episode
          stays identifiable - every episode of a series shares the same
          title. */}
      <View
        testID="feed-item-episode-cluster"
        pointerEvents={isClearDisplay ? 'none' : 'box-none'}
        // Same accessibility-tree hiding as the title overlay above.
        accessibilityElementsHidden={isClearDisplay}
        importantForAccessibility={isClearDisplay ? 'no-hide-descendants' : 'auto'}
        style={[
          styles.episodeCluster,
          { bottom: overlayBottom },
          isClearDisplay && styles.contentHidden,
        ]}>
        {/* `maxFontSizeMultiplier` matches the cap the tab bar's own labels
            use (see `(tabs)/_layout.tsx`): this row now shares the bottom
            band with those labels, and an uncapped OS text size at 200% on a
            small Android screen is what turns a two-item row into a clipped
            one. The cap bounds each line's height; `flexWrap` on the
            container handles the row's width. */}
        <Text
          testID="feed-item-episode-indicator"
          maxFontSizeMultiplier={OVERLAY_MAX_FONT_SCALE}
          style={[styles.episodeIndicator, styles.textShadow]}>
          {`EP ${video.episodeNumber}`}
        </Text>
        {nextEpisode ? (
          <Pressable
            testID="feed-item-next-episode"
            accessibilityRole="button"
            accessibilityLabel={t('feed.nextEpisode')}
            onPress={handleNextEpisode}
            style={({ pressed }) => [styles.nextEpisodeButton, pressed && styles.buttonPressed]}>
            <Text maxFontSizeMultiplier={OVERLAY_MAX_FONT_SCALE} numberOfLines={1} style={styles.nextEpisodeText}>
              {t('feed.nextEpisode')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Mobile UI revision (2026-08-12): the bottom overlay now carries the
          action rail alone - title/channel/episode metadata moved to the
          upper-left title overlay above, and the caption no longer renders
          in the feed at all (the data itself is untouched: Discover search
          and Share still read `video.caption`). */}
      <View
        testID="feed-item-bottom-overlay"
        pointerEvents={isClearDisplay ? 'none' : 'box-none'}
        // Same accessibility-tree hiding as the title overlay above.
        accessibilityElementsHidden={isClearDisplay}
        importantForAccessibility={isClearDisplay ? 'no-hide-descendants' : 'auto'}
        style={[styles.content, { bottom: overlayBottom }, isClearDisplay && styles.contentHidden]}>
        <View testID="feed-item-actions-rail" style={styles.actions}>
          {/* Fullscreen is NOT in this rail any more (product decision
              2026-08-13). It moved into the Playback Settings sheet behind
              the vertical-kebab so the rail carries exactly one kind of
              thing - the four per-video social actions - and so fullscreen
              is not duplicated across two surfaces. Only the ENTRY POINT
              moved: `handleEnterFullscreen`, the VideoView fullscreen
              options, and the enter/exit lifecycle below are untouched. */}
          {hasPlaybackError ? null : (
            <Pressable
              accessibilityLabel={isMuted ? t('feed.unmute') : t('feed.mute')}
              accessibilityRole="button"
              // Rail taps are "meaningful interaction" for the idle
              // countdown: the viewer is using the chrome, so the auto
              // clear-display timer starts over from a full delay.
              onPress={() => {
                noteChromeInteraction();
                onToggleMute();
              }}
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
            accessibilityLabel={isLiked ? t('feed.unlike') : t('feed.like')}
            accessibilityRole="button"
            onPress={() => {
              noteChromeInteraction();
              onToggleLike();
            }}
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
            accessibilityLabel={isSaved ? t('feed.unsave') : t('feed.save')}
            accessibilityRole="button"
            onPress={() => {
              noteChromeInteraction();
              onToggleSave();
            }}
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
            accessibilityLabel={t('feed.share')}
            accessibilityRole="button"
            onPress={() => {
              noteChromeInteraction();
              onShare();
            }}
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
          bottom={progressBottom}
        />
      )}

      <PremiumPreviewModal
        onDismiss={() => setIsPremiumModalVisible(false)}
        onGoToFreeEpisode={firstFreeEpisodeInSeries ? handleGoToFreeEpisode : undefined}
        visible={isPremiumModalVisible}
      />

      {hasPlaybackError ? null : (
        <PlaybackSettingsSheet
          isClearDisplay={isClearDisplay}
          onClose={handleCloseSettingsSheet}
          onDismissed={handleSettingsSheetDismissed}
          onEnterFullscreen={isHorizontal ? handleEnterFullscreenFromSheet : undefined}
          onSelectPlaybackSpeed={setPlaybackSpeed}
          onToggleClearDisplay={handleToggleClearDisplayFromSheet}
          playbackSpeed={playbackSpeed}
          visible={isSettingsSheetVisible}
        />
      )}
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
  // 11R PLAYBACK-STABILITY REMEDIATION: identical geometry to `video` above
  // (it sits directly on top of the VideoView) - real content instead of a
  // black frame for exactly as long as no real frame has been shown yet.
  poster: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
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
  // Guest-first feed (2026-08-22): the one control in the signed-out
  // playback state, sized to the same 44pt floor the next-episode pill
  // already respects.
  signInButton: {
    marginTop: 6,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    backgroundColor: Palette.primary,
  },
  signInButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.bold,
    color: Palette.text,
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
  // Lays "EP n" and the next-episode control out as one LEFT-aligned row in
  // the lower control band; `bottom` is provided inline from
  // `useFeedBottomAnchor`'s `overlayBottom`, the same tab-bar/safe-area-
  // derived anchor the action rail uses, so the two share one band and
  // neither can end up under the tab bar or the Android gesture area.
  //
  // `left` matches the title overlay and Home's brand overlay, so all three
  // sit on one 18px left rail. `right` reserves the action rail's column so
  // a long localized pill label wraps its own ellipsis instead of sliding
  // underneath the rail's buttons. `flexWrap` is the small-screen backstop:
  // if a narrow viewport plus a large OS text size ever leaves the row wider
  // than that budget, the pill wraps onto the line below the indicator
  // rather than being clipped.
  //
  // `zIndex` is load-bearing now, in a way it was not while this sat in the
  // upper-right corner: the bottom overlay is declared AFTER this view and
  // spans the full width, so by paint order it lies on top of this one. It
  // is `box-none`, so it does not take touches itself and its only child
  // (the action rail) is off in the reserved column - but relying on that to
  // keep the next-episode control tappable is relying on a hit-testing
  // detail. Lifting this above it makes the control's tap target explicit
  // instead, matching what `overflowButton` already does for the kebab.
  episodeCluster: {
    position: 'absolute',
    left: 18,
    right: ACTION_RAIL_CLEARANCE,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    zIndex: 2,
  },
  // Full-bleed single-tap target for clear display. Declared FIRST among the
  // overlays so paint order keeps it under every real control.
  clearDisplaySurface: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  // Full-bleed so the gate lands in the optical centre of the frame exactly
  // where it did as a child of the video layer; `pointerEvents="box-none"` on
  // the element itself is what keeps the empty area around the gate belonging
  // to the clear-display surface underneath.
  //
  // Reviewer B (LOW): the `zIndex` makes "the gate is topmost" STRUCTURAL
  // rather than positional. Declaration order alone is not enough here -
  // `episodeCluster` and `overflowButton` both carry an explicit `zIndex: 2`,
  // which would paint them over this layer wherever the boxes overlapped, no
  // matter that this one is declared first. They do not overlap at today's
  // spacing, but that is an implicit invariant ("the gate card never grows
  // tall enough to reach the bottom band") that a longer localized hint or a
  // short viewport at a large OS text size could quietly break. 3 beats both
  // of them, so the one explanation for why playback is blocked can never
  // end up underneath a control.
  accessGateLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  overflowButton: {
    position: 'absolute',
    right: 12,
    width: OVERFLOW_BUTTON_SIZE,
    height: OVERFLOW_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  overflowKebab: {
    alignItems: 'center',
    gap: 3.5,
  },
  overflowKebabDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: Radius.pill,
    backgroundColor: '#fff',
    // Matches the rail's treatment: fully transparent control, legibility
    // carried by the glyph shadow rather than a scrim.
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 2.5,
    shadowOffset: { width: 0, height: 1 },
  },
  // `maxWidth` is belt-and-suspenders on top of the vertical separation from
  // the title: even an unexpectedly long localized label can never grow the
  // pill across the frame (its text ellipsizes instead).
  nextEpisodeButton: {
    minWidth: 74,
    maxWidth: 180,
    // 44 is the iOS minimum; the pill's own 12pt line + 8pt padding lands
    // around 31, which is under both platform floors. It matters more now
    // that this control sits directly beneath the new kebab.
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  // The upper-left title block. It can no longer collide with the
  // next-episode pill at all - that moved to the lower control band
  // (`episodeCluster`) - so `right: 112` is now purely the aesthetic measure
  // it always also was: a long title wraps as a compact block instead of
  // running edge-to-edge, and it stays clear of the top-right kebab.
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
    // UI polish (2026-08-22): unchanged in SIZE - 18/extraBold was already
    // exactly `Typography.title` - but taken from the token now rather than
    // re-declaring the same two values. That is what makes the hierarchy
    // enforceable: the brand mark above reads `Typography.body` (14/regular),
    // so "title is larger and heavier than the line above it" is a property of
    // the token scale, not of two literals that can drift apart.
    ...Typography.title,
    lineHeight: 23,
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
