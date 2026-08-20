/**
 * The platform-neutral half of the interstitial adapter's public interface.
 *
 * It deliberately lives in its own module rather than in
 * `interstitial-adapter.ts`, so `interstitial-adapter.web.ts` can share the
 * exact same callback type without importing anything from the native
 * adapter. A bare `import type` would be erased before Metro ever saw it,
 * but a later edit that dropped the `type` keyword would silently put the
 * native adapter - and through it `react-native-google-mobile-ads` - back
 * into the web module graph. Keeping the shared type here removes that
 * hazard instead of relying on an erasure detail to hold.
 */
export type InterstitialCallbacks = {
  readonly onOpened: () => void;
  readonly onClosed: () => void;
  readonly onError: (error: Error) => void;
};
