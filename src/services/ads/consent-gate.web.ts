/**
 * The web counterpart to `consent-gate.ts`, existing for the same
 * build-time reason as `interstitial-adapter.web.ts`: Metro picks this file
 * for `platform: web`, so `react-native-google-mobile-ads` - and through it
 * `codegenNativeComponent`, which Expo's web resolver rejects outright - is
 * never RESOLVED into the web bundle.
 *
 * There is nothing to gate on web: `interstitial-adapter.web.ts` returns a
 * null presenter, so no ad is ever requested there in the first place. This
 * file still answers `false` rather than `true`, so the "no consent, no ad
 * request" invariant reads the same on every platform and a future web ad
 * surface cannot accidentally inherit a permissive default.
 */
export function ensureAdsConsent(): Promise<boolean> {
  return Promise.resolve(false);
}

/**
 * Web never runs the UMP sequence, so it never learns that a region requires
 * the privacy-options control - and there is no ad surface for it to govern.
 * Answering `false` keeps the Profile row off web rather than rendering one
 * that opens nothing.
 */
export function isAdPrivacyOptionsRequired(): boolean {
  return false;
}

/** Nothing to show: web has no UMP form. */
export function showAdPrivacyOptionsForm(): Promise<boolean> {
  return Promise.resolve(false);
}

/** Present only so both platform files expose the identical surface. */
export function __resetConsentGateForTests(): void {
  // No state to reset - this file holds none by design.
}
