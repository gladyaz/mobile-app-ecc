import { Platform } from 'react-native';

/**
 * The UMP (User Messaging Platform) consent gate that every ad REQUEST has
 * to pass through, plus the Mobile Ads SDK initialization that Google
 * requires before any request at all.
 *
 * Why this exists as its own module rather than inline in
 * `interstitial-adapter.ts`: the sequence is app-wide and runs exactly once
 * per session, while the adapter is per-presenter and can be recreated
 * (premium flips, config changes). Memoizing here means a recreated
 * presenter never re-runs the consent flow, and any future ad format gets
 * the same gate for free.
 *
 * The sequence, in the order Google documents it and in the order the V1
 * release requires:
 *   1. `AdsConsent.requestInfoUpdate()`   - what does this user's region need?
 *   2. `AdsConsent.loadAndShowConsentFormIfRequired()` - show the form, if
 *      one is required AND available.
 *   3. `MobileAds().initialize()`         - Google's SDK refuses to serve
 *      without this.
 *   4. only then may a caller request an ad.
 *
 * EXTERNAL BLOCKER, not a code gap: every call below is a no-op until a
 * consent message (GDPR, and the US-states message) is created AND
 * PUBLISHED in the AdMob console for this app, under
 * Privacy & messaging. Until then `requestInfoUpdate()` reports
 * `isConsentFormAvailable: false`, no form is ever shown, and in the EEA/UK
 * `canRequestAds` stays false - which this module deliberately treats as
 * "no ads", not "ads anyway". Publishing those messages is a console task
 * the release owner has to do; no amount of client code substitutes for it.
 *
 * Fails CLOSED throughout: any rejection, any `canRequestAds: false`, and
 * web all resolve `false`, and a `false` result means the adapter never
 * calls `load()`, so no ad is ever requested.
 */

/**
 * A failed sequence is retried, but not on every video transition - a
 * viewer with no connectivity at launch would otherwise re-drive the whole
 * UMP flow several times a minute for the rest of the session. One minute
 * is short enough that a brief launch-time blip costs at most one ad slot.
 */
const CONSENT_RETRY_COOLDOWN_MS = 60_000;

/** Latched only on success: consent cannot un-settle within a session. */
let hasSettledSuccessfully = false;
let inFlight: Promise<boolean> | null = null;
let lastFailureAt: number | null = null;

async function runConsentSequence(): Promise<boolean> {
  if (Platform.OS === 'web') {
    // Defensive only - Metro resolves `consent-gate.web.ts` for web, so this
    // file is not in that bundle. Mirrors the same second-net reasoning as
    // `interstitial-adapter.ts`'s own web guard.
    return false;
  }

  // Lazy `require`, matching `interstitial-adapter.ts`: importing this
  // module must never trigger the native SDK's load-time side effects, and
  // it keeps every test that does not care about consent free of the SDK.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rngma = require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  const { AdsConsent, AdsConsentStatus, MobileAds } = rngma;

  let info = await AdsConsent.requestInfoUpdate();

  if (
    info.isConsentFormAvailable &&
    (info.status === AdsConsentStatus.REQUIRED || info.status === AdsConsentStatus.UNKNOWN)
  ) {
    // `loadAndShowConsentFormIfRequired` is the v16 helper for exactly this
    // "show the form at app start if it is needed" case, and it returns the
    // refreshed info - so the `canRequestAds` decision below is made on the
    // post-form answer, never the pre-form one.
    info = await AdsConsent.loadAndShowConsentFormIfRequired();
  }

  if (!info.canRequestAds) {
    return false;
  }

  await MobileAds().initialize();

  return true;
}

/**
 * Resolves `true` only once the whole sequence above has settled AND the
 * user's consent state permits an ad request. Single-flight: concurrent
 * callers (several video transitions, a foreground event) share one run
 * rather than each starting their own UMP flow.
 *
 * Never rejects. A caller that gets `false` must not request an ad.
 */
export function ensureAdsConsent(): Promise<boolean> {
  if (hasSettledSuccessfully) {
    return Promise.resolve(true);
  }

  if (inFlight) {
    return inFlight;
  }

  if (lastFailureAt !== null && Date.now() - lastFailureAt < CONSENT_RETRY_COOLDOWN_MS) {
    return Promise.resolve(false);
  }

  inFlight = runConsentSequence()
    .catch((error: unknown) => {
      if (__DEV__) {
        console.warn(
          '[consent-gate] UMP consent sequence failed; no ad will be requested.',
          error
        );
      }

      return false;
    })
    .then((canRequestAds) => {
      if (canRequestAds) {
        hasSettledSuccessfully = true;
        lastFailureAt = null;
      } else {
        lastFailureAt = Date.now();
      }

      inFlight = null;

      return canRequestAds;
    });

  return inFlight;
}

/** Test-only: drops the memoized session state so each case starts clean. */
export function __resetConsentGateForTests(): void {
  hasSettledSuccessfully = false;
  inFlight = null;
  lastFailureAt = null;
}
