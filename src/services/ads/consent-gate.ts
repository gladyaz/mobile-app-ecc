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

/**
 * Whether Google told us this user's region requires an ongoing way to change
 * their ad-consent choice, recorded from the last `requestInfoUpdate()`.
 *
 * UMP's integration requirement is not only "show a form once". When
 * `privacyOptionsRequirementStatus` is REQUIRED - which it is throughout the
 * EEA and the UK - the app must ALSO expose a persistent control that reopens
 * the form, so somebody who accepted personalised ads at first launch can
 * withdraw that later. Without it there is no route back: the form is shown
 * once and never again, and the choice is effectively permanent.
 *
 * `false` until proven otherwise, so a region that does not require the control
 * never grows a settings row it has no use for.
 */
let isPrivacyOptionsRequired = false;

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

  // Recorded from the POST-form info for the same reason `canRequestAds` is:
  // the requirement can change as a result of what the viewer chose.
  //
  // Compared against the literal rather than
  // `AdsConsentPrivacyOptionsRequirementStatus.REQUIRED`, because the enum is a
  // plain string enum whose members ARE these literals
  // (specs/modules/NativeConsentModule.ts) and reading it off the lazily
  // required module would make this line throw on any consumer whose SDK stub
  // does not re-export it - turning a missing test double into "consent
  // failed", which fails closed and silently disables ads.
  isPrivacyOptionsRequired = info.privacyOptionsRequirementStatus === 'REQUIRED';

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

/**
 * Whether this build must offer a persistent "ad privacy options" control.
 *
 * Reads the answer recorded by the last consent sequence, so it is `false`
 * until that sequence has run and Google has said the region requires it. The
 * Profile screen renders its row off this, which means the row appears for an
 * EEA/UK viewer and stays absent everywhere else instead of showing a control
 * that opens nothing.
 */
export function isAdPrivacyOptionsRequired(): boolean {
  return isPrivacyOptionsRequired;
}

/**
 * Reopens Google's privacy options form so a viewer can change or withdraw the
 * ad-consent choice they made at first launch.
 *
 * Resolves `false` rather than rejecting when the form cannot be shown, so a
 * caller can report a failure instead of crashing on one. It deliberately does
 * NOT re-run the whole consent sequence: `ensureAdsConsent` has already
 * latched, and the ad state Google returns after the form is applied on the
 * next `requestInfoUpdate` - which is the next launch.
 */
export async function showAdPrivacyOptionsForm(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AdsConsent } = require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');

    await AdsConsent.showPrivacyOptionsForm();

    return true;
  } catch (error) {
    if (__DEV__) {
      console.warn('[consent-gate] Could not show the ad privacy options form.', error);
    }

    return false;
  }
}

/** Test-only: drops the memoized session state so each case starts clean. */
export function __resetConsentGateForTests(): void {
  hasSettledSuccessfully = false;
  inFlight = null;
  lastFailureAt = null;
  isPrivacyOptionsRequired = false;
}
