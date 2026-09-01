import Hls from 'hls.js';

/**
 * Work unit "HLS WEB PLAYBACK" - the WEB half of a platform-split module (see
 * `web-hls.ts` for the native no-op sibling and why the split exists).
 *
 * ## The problem this solves
 *
 * `expo-video` on web is a thin wrapper over a plain `<video>` element: it
 * renders `<video src={...}>` and lets the browser do the rest. That is fine
 * for progressive MP4 and useless for HLS, because only Safari implements HLS
 * natively - Chrome and Firefox cannot play an `.m3u8` at all. So on those
 * browsers an HLS-ready episode produced a permanently failing element no
 * matter how healthy the pipeline behind it was.
 *
 * `hls.js` fills exactly that hole: it fetches the manifest and segments
 * itself over XHR, feeds them through MediaSource Extensions, and hands the
 * `<video>` element a blob URL. Adaptive bitrate switching is its own, and
 * this is where the ladder's multiple renditions actually get chosen between
 * on the web.
 *
 * ## Why it takes a container rather than the element
 *
 * `expo-video`'s `VideoView` does not expose its underlying DOM node - its
 * ref is the `VideoView` component API, not the `<video>`. The container
 * `View` wrapping it renders as a `div` that contains exactly one `<video>`,
 * so a scoped `querySelector` is the supported way to reach it. Deliberately
 * scoped to the passed container and never `document.querySelector`: the feed
 * mounts several items at once, and a document-wide lookup would attach this
 * item's engine to a neighbour's element.
 *
 * ## Failure is never silent
 *
 * A fatal `hls.js` error (manifest unreachable, CORS refused, MediaSource
 * unavailable) invokes `onFatalError`, which the caller uses to flip
 * `hlsPlayable` to `false` and re-resolve the source onto the response's MP4
 * `fallback`. A browser that cannot do HLS therefore degrades to the same MP4
 * the episode served before it was transcoded, rather than to a black frame.
 */

/** How the caller detaches; always safe to call more than once. */
export type DetachWebHlsEngine = () => void;

/**
 * Whether this browser can play HLS at ALL - natively or through `hls.js`.
 *
 * `Hls.isSupported()` is the real question for Chrome/Firefox (it tests
 * MediaSource Extensions support). Safari answers `false` there while still
 * playing HLS perfectly via its own engine, so `canPlayType` is checked too -
 * otherwise Safari would be needlessly pushed onto the MP4 fallback.
 */
export function canPlayHlsInThisRuntime(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  if (Hls.isSupported()) {
    return true;
  }

  return hasNativeHlsSupport();
}

/**
 * True when the browser plays HLS itself (Safari). In that case `<video src>`
 * works verbatim and `hls.js` must NOT be attached - doing so would replace a
 * working native pipeline with a strictly worse JavaScript one.
 */
function hasNativeHlsSupport(): boolean {
  const probe = document.createElement('video');
  return probe.canPlayType('application/vnd.apple.mpegurl') !== '';
}

/**
 * The one `<video>` inside this item's own container. Deliberately scoped to
 * the container and never `document` - the feed mounts several items at once,
 * and a document-wide lookup would attach this item's engine to a neighbour's
 * element.
 */
function findVideoElement(container: unknown): HTMLVideoElement | null {
  const root = container as { querySelector?: (s: string) => unknown } | null;

  return typeof root?.querySelector === 'function'
    ? (root.querySelector('video') as HTMLVideoElement | null)
    : null;
}

/** How many animation frames to wait for the element before giving up. */
const ATTACH_RETRY_FRAMES = 5;

/**
 * Waits a few frames for the `<video>` to appear, then attaches - or reports
 * a fatal failure so the item falls back to MP4 rather than sitting on a
 * manifest this browser cannot decode.
 */
function scheduleAttachRetry(
  container: unknown,
  masterUrl: string,
  onFatalError: () => void
): DetachWebHlsEngine {
  let cancelled = false;
  let detach: DetachWebHlsEngine | null = null;
  let framesLeft = ATTACH_RETRY_FRAMES;

  const tick = () => {
    if (cancelled) {
      return;
    }

    if (findVideoElement(container)) {
      detach = attachWebHlsEngine(container, masterUrl, onFatalError);
      return;
    }

    framesLeft -= 1;
    if (framesLeft <= 0) {
      onFatalError();
      return;
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    detach?.();
  };
}

/**
 * Attaches `hls.js` to the `<video>` inside `container` and loads `masterUrl`.
 *
 * Returns `null` - meaning "nothing attached, leave the element alone" - for
 * every case where attaching would be wrong or impossible: the browser has
 * native HLS (Safari), `hls.js` is unsupported, or the element is not mounted
 * yet. `null` is not an error; the caller treats it as "the player owns the
 * source", which is correct in all three cases.
 */
export function attachWebHlsEngine(
  container: unknown,
  masterUrl: string,
  onFatalError: () => void
): DetachWebHlsEngine | null {
  if (typeof document === 'undefined' || !Hls.isSupported()) {
    return null;
  }

  // Safari: its own engine is already handling the `<video src>`. Attaching
  // hls.js on top would be a downgrade, not a fix.
  if (hasNativeHlsSupport()) {
    return null;
  }

  const element = findVideoElement(container);

  if (!element) {
    // The `<video>` is not in the DOM yet. Effects run after the commit that
    // renders it, so this is rare - but it must never be silent: this browser
    // has NO native HLS (checked above), so if nothing attaches, the element
    // is left holding an `.m3u8` it cannot decode and playback stalls with no
    // error anyone can act on. Retry on the next frames, then declare it
    // fatal so the caller falls back to MP4.
    return scheduleAttachRetry(container, masterUrl, onFatalError);
  }

  const hls = new Hls({
    // Small VOD clips: keep the defaults, which already pick a start level
    // from the measured bandwidth rather than pinning one. The ladder's whole
    // purpose is that this decision is not ours to hardcode.
    enableWorker: true,
  });

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      return;
    }

    // Recoverable classes get an in-place recovery attempt - hls.js's own
    // documented handling - before the caller is told to fall back. Anything
    // else (a refused manifest, a CORS rejection) is fatal immediately:
    // retrying a request the browser will refuse identically just delays the
    // MP4 the viewer could already be watching.
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details !== 'manifestLoadError') {
      hls.startLoad();
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
      return;
    }

    onFatalError();
  });

  // `loadSource` before `attachMedia` so the manifest request is already in
  // flight while MediaSource is being wired up.
  hls.loadSource(masterUrl);
  hls.attachMedia(element);

  return () => {
    // `destroy()` detaches from the element, aborts in-flight requests and
    // revokes the blob URL. Guarded because React may run this after the
    // element is already gone.
    try {
      hls.destroy();
    } catch {
      // Already destroyed / element torn down first - nothing left to undo.
    }
  };
}
