import { isGoogleSignInConfigured, isGoogleSignInSupported } from '@/services/auth/google-sign-in';
import { isDemoMode } from '@/services/demo/demo-mode';

/**
 * Which sign-in methods a build may OFFER.
 *
 * Separate from whether a method WORKS, and separate again from whether the
 * backend will accept it. This module answers only the first question, because
 * that is the one a store build gets wrong in a way a viewer feels: an offered
 * method that cannot succeed is a dead end at the exact moment a first-time
 * user is deciding whether the app works at all.
 *
 * Nothing here deletes or disables a provider's implementation. The routes,
 * the services and their tests are untouched; only the entry point is gated,
 * so re-offering a method is a configuration change and a rebuild, not a code
 * change.
 */

/**
 * WhatsApp OTP sign-in is OFFERED BY DEFAULT: it is a confirmed V1 feature.
 *
 * THIS DEFAULT WAS INVERTED (2026-08-26) BY PRODUCT DECISION. It previously
 * defaulted OFF, on the reasoning that the backend could not serve the method -
 * docs/api-contract.md ("Provider activation status") records that WhatsApp
 * auth "CANNOT be enabled in production. Only a `fake` driver exists and the
 * process refuses to boot with WhatsApp enabled outside development/test", so
 * a deployed server answers `503 WHATSAPP_AUTH_DISABLED`. That reasoning was
 * sound for a build shipping alone; it is not the decision that was made.
 * WhatsApp Login is in the V1 scope, its production backend is being built on a
 * parallel branch, and the button is not to be withdrawn while that lands.
 *
 * WHAT THIS DOES NOT DO, and must never be changed to do: it does not fake a
 * session, stub a code, or treat a 503 as anything other than a failure. The
 * client flow is REAL end to end - `startWhatsAppOtp` and `verifyWhatsAppOtp`
 * (`provider-auth-service.ts`) call the canonical endpoints, validate the
 * response shape, and propagate `ApiError` untouched. Until the backend serves
 * the method, a viewer who tries it gets the specific, truthful message
 * `provider-error-messages.ts` maps `WHATSAPP_AUTH_DISABLED` to
 * ("Login WhatsApp belum aktif di server ini") - never a signed-in state the
 * server did not grant. That trade - an honest "not active yet" over a hidden
 * V1 feature - is the decision this default encodes.
 *
 * Set to "false" to withdraw the entry point (a kill switch, matching
 * `services/videos/hls-playback-flag.ts`); anything else offers it.
 */
export function isWhatsAppLoginOffered(): boolean {
  return process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED !== 'false';
}

/**
 * Google sign-in is offered when the build actually carries the client ID that
 * makes it work.
 *
 * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is read at BUILD time (Expo inlines every
 * EXPO_PUBLIC_* value into the bundle), so "configured" is a fixed property of
 * an artifact - a shipped build either can do this or never can. Without it,
 * `google-sign-in-contract.ts` resolves to its "not configured" state and the
 * button reports exactly that, which is honest but still a dead tap for
 * somebody who just wanted to sign in.
 *
 * The exception is development, where the button stays visible even
 * unconfigured: the login screen prints a hint saying why, and a developer
 * needs the failure to be reproducible rather than hidden.
 */
export function isGoogleLoginOffered(): boolean {
  if (!isGoogleSignInSupported()) {
    return false;
  }

  return isGoogleSignInConfigured() || __DEV__;
}

/**
 * A demo build has no backend to exchange a provider token with, so it offers
 * no provider at all. Kept here so the login screen asks one module the whole
 * question instead of assembling the answer from three.
 */
export function isAnyProviderLoginOffered(): boolean {
  if (isDemoMode()) {
    return false;
  }

  return isGoogleLoginOffered() || isWhatsAppLoginOffered();
}
