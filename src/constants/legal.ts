/**
 * The app's public legal pages.
 *
 * Google Play requires a privacy policy URL in the store listing for any app
 * that collects account data or serves ads - this app does both - and a web
 * account-deletion page reachable WITHOUT installing the app, even when an
 * in-app deletion path exists. Neither page exists yet, and neither can be
 * invented here: a URL that 404s is worse than no link, and a fabricated one
 * in a store listing is a policy problem rather than a cosmetic one.
 *
 * So the values come from configuration, and every surface that would link to
 * them renders NOTHING when they are absent. A build without these URLs simply
 * has no legal rows; a build with them has working ones. That is what makes
 * publishing the pages a configuration step rather than a code change, and it
 * is why `npm run release:preflight` treats an unset privacy policy URL as a
 * blocker for external distribution rather than something to notice later.
 *
 * These are EXPO_PUBLIC_* values, so they are inlined into the bundle at build
 * time and are fixed properties of an artifact - they are public URLs, and
 * nothing here is or may become a secret.
 */

/**
 * Accepts only an absolute https URL.
 *
 * A relative path, an http URL, or a typo would each produce a row that opens
 * nothing (or opens something over cleartext, which Android blocks by default
 * anyway). Rejecting them here means the row is absent rather than broken,
 * which is the same rule the rest of this module follows.
 */
function readHttpsUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The published privacy policy. Required by Google Play for this app. */
export function getPrivacyPolicyUrl(): string | undefined {
  // Static member access, matching the rule `expo/no-dynamic-env-var` enforces
  // across src/: Expo can only inline a literal `process.env.EXPO_PUBLIC_X`.
  return readHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL);
}

/** The published terms of service. Optional for Play; linked when it exists. */
export function getTermsUrl(): string | undefined {
  return readHttpsUrl(process.env.EXPO_PUBLIC_TERMS_URL);
}

/**
 * The web page where somebody can request account deletion without installing
 * the app. Google Play requires this URL in the Data safety declaration even
 * when the app also offers in-app deletion, and it is the only route available
 * to an account that cannot use the in-app path (see account-data.tsx).
 */
export function getAccountDeletionUrl(): string | undefined {
  return readHttpsUrl(process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL);
}

/** Whether there is anything at all to put in a legal section. */
export function hasAnyLegalUrl(): boolean {
  return Boolean(getPrivacyPolicyUrl() ?? getTermsUrl() ?? getAccountDeletionUrl());
}
