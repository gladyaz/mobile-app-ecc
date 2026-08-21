import {
  AUTH_PROVIDER_IDS,
  LINKABLE_AUTH_PROVIDER_IDS,
  type AuthIdentitySummary,
  type AuthProviderId,
  type LinkableAuthProviderId,
} from '@/types/auth';

/**
 * The account-linking rules, kept pure and away from the card that renders
 * them so the one rule that really matters - "never unlink the last way in"
 * - can be tested directly instead of through a screen.
 */

export type AuthMethodRow = {
  readonly provider: AuthProviderId;
  readonly isLinked: boolean;
  /** Safe-to-display label from the backend (own email, masked phone), or
   * null when the provider asserted nothing displayable. Never a raw
   * `providerSubject`. */
  readonly identifier: string | null;
  /**
   * False for an unlinked method (nothing to remove) AND for the last
   * linked one, which is the lockout guard: removing it would leave the
   * account with no way to sign in at all.
   *
   * Taken from the SERVER's `canBeUnlinked` for a linked identity - see
   * `resolveCanUnlink`.
   */
  readonly canUnlink: boolean;
  /** Whether this row should offer a "link this provider" control. */
  readonly canLink: boolean;
  /**
   * The server's `usable` flag for a linked identity, defaulting to true
   * for a row with nothing linked. No current backend path produces an
   * unusable identity, so this is rendered defensively rather than as a
   * state a viewer is expected to meet - but a client that silently
   * discarded the flag would show "Terhubung" for a method that cannot
   * actually sign anyone in.
   */
  readonly usable: boolean;
  /**
   * True when this is the account's ONLY linked method. Distinct from
   * `!canUnlink`, which is also false for `email` on an account with three
   * methods (the backend refuses that provider on the identity routes as a
   * matter of lifecycle, not lockout). Only this flag justifies telling
   * someone "this is the only way you can sign in".
   */
  readonly isOnlyMethod: boolean;
};

function isKnownProvider(value: string): value is AuthProviderId {
  return (AUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isLinkableProvider(value: string): value is LinkableAuthProviderId {
  return (LINKABLE_AUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Drops any identity whose provider this app doesn't know about. A provider
 * the client cannot render is a contract mismatch to reconcile, not a row
 * to invent - and silently keeping it would corrupt the count the unlink
 * guard below depends on.
 */
function knownIdentities(
  identities: readonly AuthIdentitySummary[]
): readonly AuthIdentitySummary[] {
  return identities.filter((identity) => isKnownProvider(identity.provider));
}

/**
 * Whether `provider` may be unlinked from an account whose current
 * identities are `identities`, computed LOCALLY.
 *
 * A usability guard, not a security boundary: the backend enforces the same
 * invariant and answers `AUTH_LAST_IDENTITY` (409) if a stale UI ever asks
 * it to remove the final usable identity. This exists so the UI never
 * offers an action that would lock someone out of their own account.
 *
 * Under the canonical contract the server also sends its own
 * `canBeUnlinked`, which is authoritative - see `resolveCanUnlink`. This
 * function remains the fallback for an identity that arrives without the
 * flag, and it is exported because it is the rule worth testing directly.
 */
export function canUnlinkAuthMethod(
  identities: readonly AuthIdentitySummary[],
  provider: AuthProviderId
): boolean {
  const linked = knownIdentities(identities);
  const isLinked = linked.some((identity) => identity.provider === provider);

  return isLinked && linked.length > 1;
}

/**
 * Reconciles the server's `canBeUnlinked` with the local guard.
 *
 * The server flag WINS when it says no, and the local guard can only ever
 * narrow further - the two are ANDed. That ordering is the point: the
 * backend computes the flag with the exact rule `DELETE` enforces, so it is
 * the authority, and a client that could turn a server refusal back into an
 * offer would be presenting an action guaranteed to fail. The local rule
 * still runs because it is the one that stays correct if the flag is
 * missing, and because agreeing twice costs nothing.
 *
 * `email` is additionally never unlinkable from this surface: the backend
 * rejects that provider on the identity routes outright (its lifecycle
 * belongs to register / change-password / password-reset / deletion).
 */
function resolveCanUnlink(
  identity: AuthIdentitySummary | undefined,
  identities: readonly AuthIdentitySummary[],
  provider: AuthProviderId
): boolean {
  if (!identity || !isLinkableProvider(provider)) {
    return false;
  }

  return identity.canBeUnlinked && canUnlinkAuthMethod(identities, provider);
}

/**
 * Expands the backend's identity list into one row per supported provider,
 * so the card always shows all three - a viewer can see what they could
 * add, not only what they already have.
 */
export function buildAuthMethodRows(
  identities: readonly AuthIdentitySummary[]
): readonly AuthMethodRow[] {
  const linked = knownIdentities(identities);

  return AUTH_PROVIDER_IDS.map((provider) => {
    const match = linked.find((identity) => identity.provider === provider);

    return {
      provider,
      isLinked: Boolean(match),
      identifier: match?.identifier ?? null,
      canUnlink: resolveCanUnlink(match, linked, provider),
      usable: match ? match.usable : true,
      isOnlyMethod: Boolean(match) && linked.length === 1,
      // Email is absent from the linkable set on purpose: there is no
      // "link an email identity" route, because an email identity is
      // created by registration and nothing else.
      canLink: !match && isLinkableProvider(provider),
    };
  });
}
