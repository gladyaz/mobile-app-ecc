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
 * WhatsApp OTP is gated OFF by default because the backend cannot serve it.
 *
 * docs/api-contract.md ("Provider activation status") records that WhatsApp
 * auth "CANNOT be enabled in production. Only a `fake` driver exists and the
 * process refuses to boot with WhatsApp enabled outside development/test", and
 * that no real WhatsApp message has ever been sent by that code. A deployed
 * server therefore answers every request with `503 WHATSAPP_AUTH_DISABLED`.
 *
 * The client handles that 503 honestly - `provider-error-messages.ts` maps it
 * to its own specific message rather than a generic failure - but handling a
 * refusal well is not the same as being worth offering. Showing a viewer a
 * WhatsApp button, taking them to a phone-number screen, and only then telling
 * them the method is unavailable is a worse experience than not showing it,
 * and it is the kind of thing that reads as a broken app rather than an
 * unfinished feature.
 *
 * Set this to "true" once a real WhatsApp Business provider is wired up on the
 * backend AND the deployment has it enabled. Until then the honest V1 answer
 * is that this app signs you in with an email and a password.
 */
export function isWhatsAppLoginOffered(): boolean {
  return process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED === 'true';
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
