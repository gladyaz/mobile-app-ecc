import { AUTH_PROVIDER_IDS, type AuthProviderId, type LinkedAuthMethod } from '@/types/auth';

/**
 * The account-linking rules, kept pure and away from the card that renders
 * them so the one rule that really matters - "never unlink the last way in"
 * - can be tested directly instead of through a screen.
 */

export type AuthMethodRow = {
  readonly provider: AuthProviderId;
  readonly isLinked: boolean;
  readonly label: string | null;
  /**
   * False for an unlinked method (nothing to remove) AND for the last
   * linked one, which is the lockout guard: removing it would leave the
   * account with no way to sign in at all.
   */
  readonly canUnlink: boolean;
};

function isKnownProvider(value: string): value is AuthProviderId {
  return (AUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Drops any method whose provider this app doesn't know about. A provider
 * the client cannot render is a contract mismatch to reconcile, not a row
 * to invent - and silently keeping it would corrupt the count the unlink
 * guard below depends on.
 */
function knownMethods(methods: readonly LinkedAuthMethod[]): readonly LinkedAuthMethod[] {
  return methods.filter((method) => isKnownProvider(method.provider));
}

/**
 * Whether `provider` may be unlinked from an account whose current methods
 * are `methods`.
 *
 * A usability guard, not a security boundary: the backend is expected to
 * enforce the same invariant (see `provider-auth-service.unlinkAuthMethod`).
 * This exists so the UI never offers an action that would lock someone out
 * of their own account.
 */
export function canUnlinkAuthMethod(
  methods: readonly LinkedAuthMethod[],
  provider: AuthProviderId
): boolean {
  const linked = knownMethods(methods);
  const isLinked = linked.some((method) => method.provider === provider);

  return isLinked && linked.length > 1;
}

/**
 * Expands the backend's "here is what is linked" list into one row per
 * supported provider, so the card always shows all three - a viewer can
 * see what they could add, not only what they already have.
 */
export function buildAuthMethodRows(
  methods: readonly LinkedAuthMethod[]
): readonly AuthMethodRow[] {
  const linked = knownMethods(methods);

  return AUTH_PROVIDER_IDS.map((provider) => {
    const match = linked.find((method) => method.provider === provider);

    return {
      provider,
      isLinked: Boolean(match),
      label: match?.label ?? null,
      canUnlink: canUnlinkAuthMethod(linked, provider),
    };
  });
}
