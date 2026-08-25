import type { PlaybackAuthorization, PlaybackRendition } from '@/types/playback';

/**
 * The video-quality model for the feed's player.
 *
 * ## Why a source swap, and not a player API
 *
 * expo-video 57.0.2 exposes `VideoPlayer.videoTrack` and
 * `availableVideoTracks` as READ-ONLY (`VideoModule.kt` registers
 * `Property("videoTrack").get {}` with no `.set {}` - unlike `subtitleTrack`
 * and `audioTrack`, which both have one). There is no `maxVideoSize`, no
 * `preferredPeakBitrate`, and no exposed `TrackSelectionParameters`. So there
 * is no way to ask the installed player to pin an HLS rendition in place.
 *
 * What there IS, is the backend's own contract: `GET /videos/:id/playback`
 * already returns, alongside the adaptive `masterUrl`, the VARIANT PLAYLIST
 * URL of every rendition it actually produced (`videos.service.ts` -
 * `{prefix}/{name}/index.m3u8`, covered by the same token and the same
 * `expiresAt`). Playing a variant playlist directly is a real, spec-level
 * rendition constraint: that playlist advertises exactly one rendition, so
 * the player can only fetch that rendition's segments. It is not a label
 * over an unchanged player.
 *
 * The cost is that a quality change replaces the source, which makes
 * expo-video hand back a new player. That is deliberately routed through the
 * EXISTING generation-swap reseek in `drama-feed-item.tsx` (the DETECT/APPLY
 * effect pair) rather than a second, competing position-restore mechanism -
 * it already captures the outgoing position and re-seeks once the INCOMING
 * player reports `readyToPlay`, which is exactly what this needs.
 *
 * ## Why manual state is a NAME, not a URL
 *
 * A manual choice stores the rendition's `quality` name (`'720p'`), never its
 * URL. A variant URL carries a short-lived gateway token, so holding one in
 * component state would pin a URL that dies at `expiresAt`; holding the name
 * means the proactive pre-expiry re-authorization re-resolves it against the
 * FRESH authorization automatically, and the generation-swap reseek carries
 * the position across - no extra machinery, no expired-source black frame.
 *
 * ## Scope
 *
 * Per video / feed item, NOT per session - the same rule, for the same
 * reason, as `playback-speed.ts`: a choice made two clips ago must not
 * silently follow the viewer down the feed. The state lives in `useState`
 * inside `DramaFeedItem` and is reset on a `video.id` change.
 */
export type PlaybackQuality =
  | { readonly mode: 'auto' }
  | {
      /**
       * Constrains playback to exactly one rendition by playing that
       * rendition's own variant playlist. ABR cannot move off it, which is
       * precisely what "manual" means.
       */
      readonly mode: 'manual';
      /**
       * The backend rendition's `quality` name (`'360p'`, `'540p'`,
       * `'720p'`, `'1080p'`) - the stable identity across authorization
       * refreshes. Never a URL: see the module comment above.
       */
      readonly quality: string;
    };

/** Auto (adaptive) is the default, and the only state a fresh item starts in. */
export const AUTO_PLAYBACK_QUALITY: PlaybackQuality = { mode: 'auto' };

/**
 * One selectable rendition, already ordered and labelled for display.
 * `shortSide` is the number the label is built from - for a PORTRAIT source
 * (every short drama here) the rendition's `height` is the LONG side (a
 * "1080p" rung of a 1080x1920 source is 1080 wide and 1920 tall), so a label
 * derived from `height` would read "1920p". The backend's own `quality` name
 * is the authority; `shortSide` is derived to sort by, and only ever from
 * the smaller of the two dimensions.
 */
export type PlaybackQualityOption = {
  readonly quality: string;
  readonly shortSide: number;
  /** True for the top rung, which the UI marks "HD". */
  readonly isHighDefinition: boolean;
};

/** A rendition at or above this short side earns the "HD" marker. */
const HIGH_DEFINITION_SHORT_SIDE = 1080;

/**
 * Below two renditions there is nothing to choose BETWEEN: "Auto" and the
 * single rendition would be the same stream under two names, which is exactly
 * the fake selector this whole module exists not to be. The UI hides the
 * section entirely in that case.
 */
const MINIMUM_SELECTABLE_RENDITIONS = 2;

function shortSideOf(rendition: PlaybackRendition): number {
  return Math.min(rendition.width, rendition.height);
}

/**
 * THE one place available qualities are derived, and it derives them from
 * nothing but the authorization the backend actually returned.
 *
 * - An MP4-shaped authorization has no renditions at all: one fixed stream,
 *   so the answer is an empty list and the UI shows no quality control.
 *   Honest by construction - there is no HLS ladder behind an MP4 source to
 *   pretend about.
 * - No authorization yet (or a failed one): empty, same as above.
 * - An HLS authorization yields EXACTLY the renditions it lists. A video
 *   whose source was too small to produce a 1080p rung simply has no 1080p
 *   entry, so no 1080p option is ever displayed.
 *
 * Ordered high-to-low, the order every streaming quality menu uses.
 */
export function selectQualityOptions(
  auth: PlaybackAuthorization | null
): readonly PlaybackQualityOption[] {
  if (auth === null || auth.kind !== 'hls') {
    return [];
  }

  if (auth.renditions.length < MINIMUM_SELECTABLE_RENDITIONS) {
    return [];
  }

  return auth.renditions
    .map((rendition) => {
      const shortSide = shortSideOf(rendition);

      return {
        quality: rendition.quality,
        shortSide,
        isHighDefinition: shortSide >= HIGH_DEFINITION_SHORT_SIDE,
      };
    })
    .sort((a, b) => b.shortSide - a.shortSide);
}

/**
 * The quality to DISPLAY as selected, which is not always the one held in
 * state: an authorization refresh can return a ladder that no longer contains
 * the chosen rendition (a re-transcode, a changed source). `resolvePlaybackSource`
 * already falls back to the adaptive master in that case, so the menu must
 * agree with the player and show Auto - rather than keep a checkmark on an
 * option that is neither listed nor playing.
 *
 * A pure derivation on purpose: no extra state to keep in sync, and no effect
 * that could fight the reconciler.
 */
export function resolveEffectiveQuality(
  quality: PlaybackQuality,
  options: readonly PlaybackQualityOption[]
): PlaybackQuality {
  if (quality.mode === 'auto') {
    return quality;
  }

  const isStillAvailable = options.some((option) => option.quality === quality.quality);

  return isStillAvailable ? quality : AUTO_PLAYBACK_QUALITY;
}
