/**
 * Work unit "HLS WEB PLAYBACK" - the NATIVE half of a platform-split module.
 *
 * Metro resolves `web-hls.web.ts` for the web bundle and THIS file for iOS and
 * Android. That split is the whole point: `hls.js` is imported only by the
 * `.web.ts` sibling, so the native bundles never contain a byte of it, and no
 * native code path can reach a browser-only API. Everything below is an
 * unconditional no-op.
 *
 * On iOS and Android nothing here is needed in the first place. `expo-video`
 * plays HLS through the platform's own engine (AVPlayer / Media3-ExoPlayer),
 * which fetches the manifest and segments directly over HTTP - no MediaSource,
 * no JavaScript engine, and no CORS involvement at all. `canPlayHlsInThisRuntime`
 * is therefore `true` here, always: the native runtime CAN play an `m3u8`, and
 * the MP4 fallback is reserved for a genuine playback failure rather than for
 * a capability the platform actually has.
 */

/**
 * How the caller detaches. Declared identically in both halves of the split
 * so a caller can hold the return value without knowing which platform it is
 * on - the native half simply never produces one.
 */
export type DetachWebHlsEngine = () => void;

/**
 * Whether this runtime can play an HLS manifest at all.
 *
 * Always `true` on native. Only the web build has a runtime that may lack an
 * HLS engine entirely (Chrome and Firefox have no native HLS; only Safari
 * does), which is why the `.web.ts` sibling computes this rather than
 * hardcoding it.
 */
export function canPlayHlsInThisRuntime(): boolean {
  return true;
}

/**
 * Attaches a JavaScript HLS engine to the `<video>` element rendered inside
 * `container`. Meaningless on native (there is no DOM and no need), so this
 * returns `null` without inspecting its arguments - a `null` return means
 * "nothing was attached; the player is driving the source itself", which is
 * exactly the native situation.
 */
export function attachWebHlsEngine(
  _container: unknown,
  _masterUrl: string,
  _onFatalError: () => void
): DetachWebHlsEngine | null {
  return null;
}
