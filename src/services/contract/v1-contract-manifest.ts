/**
 * THE V1 BACKEND <-> MOBILE CONTRACT, AS DATA.
 *
 * One machine-readable table of what this app depends on the Red Panda
 * backend to keep sending, so a drift becomes a failing test in this
 * repository rather than a dead button in a shipped build.
 *
 * ## Why a manifest and not "the tests just know"
 *
 * The wire shapes are already mirrored in three typed modules -
 * `types/auth.ts`, `services/rewards/rewards-dto.ts`, `types/playback.ts` -
 * and those mirrors are the source of truth for SHAPE. What they cannot
 * express is POLICY: which endpoints V1 actually requires, which error codes
 * a viewer must never meet as an unexplained failure, which task types and
 * perk types the earn-and-spend loop is specified to carry, and which
 * capabilities are deliberately switched OFF. That policy used to live only
 * in prose across half a dozen doc comments, where nothing could check it.
 *
 * Here it is a list a test can iterate and a document can render - the same
 * move the backend made with `common/release-gate/v1-feature-contract.ts`,
 * for the same reason, on the other side of the same contract.
 *
 * ## What this file is NOT
 *
 *  - NOT a second copy of the wire types. It names FIELDS THAT MUST EXIST,
 *    never their full structure; the mirrors own that, and duplicating them
 *    here would create two things to keep in step.
 *  - NOT a re-implementation of `scripts/check-release-android.js`. The
 *    preflight grades BUILD CONFIGURATION (env vars, signing, ad ids); this
 *    grades the WIRE CONTRACT. `v1-product-contract.test.ts` asserts the two
 *    agree about what V1 is, and deliberately runs neither one's rules twice.
 *  - NOT coupled to the backend repository. Nothing here reads a path, an
 *    import or a file from the backend checkout. The evidence these values
 *    were copied from is recorded in `fixtures/provenance.ts`.
 *
 * TEST-ONLY. No runtime module may import this file or anything under
 * `fixtures/` - `contract-boundary.test.ts` enforces that, because a policy
 * table that started deciding app behaviour would become a second, silently
 * divergent copy of the rules it exists to grade.
 *
 * See docs/v1-contract-lock.md for how to update this when the backend
 * changes.
 */

/**
 * How the app reacts to one backend error code.
 *
 * The distinction is the point of the error-code half of this lock: "the app
 * does not crash" is not the bar, because a required refusal rendered as an
 * unexplained "gagal" is a dead end a viewer cannot act on.
 *
 *  - `EXPLICIT` - the code has its own user-facing message. Required for
 *    every refusal a person can DO something about.
 *  - `GENERIC` - the code is deliberately folded into a broader branch,
 *    which must still produce a truthful message. Used where the backend
 *    itself refuses to be specific (it would leak), or where the only
 *    honest advice is identical.
 *  - `TRANSPORT` - handled below the UI, in `services/api/client.ts`, and
 *    never surfaced as a message at all.
 *  - `IGNORED` - knowingly unhandled, because no V1 surface can reach it.
 */
export type ErrorHandling = 'EXPLICIT' | 'GENERIC' | 'TRANSPORT' | 'IGNORED';

export interface V1Endpoint {
  /** Path as the client constructs it, relative to EXPO_PUBLIC_API_BASE_URL. */
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'DELETE';
  /** Whether the client attaches `Authorization: Bearer <accessToken>`. */
  readonly requiresAuth: boolean;
  /** The mobile module that owns this call. One owner per endpoint, always. */
  readonly consumer: string;
  /**
   * Response fields this app reads and would break without. NOT the whole
   * shape - the typed mirrors own that. A field listed here is one whose
   * disappearance is a product failure, not a typing inconvenience.
   */
  readonly requiredResponseFields: readonly string[];
}

export interface V1ErrorContractEntry {
  readonly code: string;
  /** The HTTP status the backend pairs with this code. */
  readonly status: number;
  readonly handling: ErrorHandling;
  /** Where the reaction lives, so a reviewer can check the claim. */
  readonly surface: string;
  /** Why this handling and not a stricter one. Never generic. */
  readonly rationale: string;
}

/* -------------------------------------------------------------------------
 * AUTH
 * ---------------------------------------------------------------------- */

export const V1_AUTH_ENDPOINTS: readonly V1Endpoint[] = [
  {
    path: 'auth/google',
    method: 'POST',
    requiresAuth: false,
    consumer: 'services/auth/provider-auth-service.ts#loginWithGoogleIdToken',
    requiredResponseFields: ['accessToken', 'refreshToken', 'user.id', 'user.email'],
  },
  {
    path: 'auth/whatsapp/otp/request',
    method: 'POST',
    requiresAuth: false,
    consumer: 'services/auth/provider-auth-service.ts#startWhatsAppOtp',
    requiredResponseFields: ['success', 'expiresInSeconds', 'resendAvailableInSeconds'],
  },
  {
    path: 'auth/whatsapp/otp/verify',
    method: 'POST',
    requiresAuth: false,
    consumer: 'services/auth/provider-auth-service.ts#verifyWhatsAppOtp',
    requiredResponseFields: ['accessToken', 'refreshToken', 'user.id', 'user.email'],
  },
  {
    path: 'auth/refresh',
    method: 'POST',
    requiresAuth: false,
    consumer: 'services/api/client.ts#runTokenRefresh',
    requiredResponseFields: ['accessToken', 'refreshToken', 'user.id', 'user.email'],
  },
  {
    path: 'auth/identities',
    method: 'GET',
    requiresAuth: true,
    consumer: 'services/auth/provider-auth-service.ts#listAuthIdentities',
    requiredResponseFields: [
      'provider',
      'identifier',
      'usable',
      'canBeUnlinked',
      'createdAt',
      'verifiedAt',
    ],
  },
  {
    path: 'auth/identities/google/link',
    method: 'POST',
    requiresAuth: true,
    consumer: 'services/auth/provider-auth-service.ts#linkGoogleIdentity',
    requiredResponseFields: ['provider', 'canBeUnlinked'],
  },
  {
    path: 'auth/identities/whatsapp/link',
    method: 'POST',
    requiresAuth: true,
    consumer: 'services/auth/provider-auth-service.ts#linkWhatsAppIdentity',
    requiredResponseFields: ['provider', 'canBeUnlinked'],
  },
  {
    path: 'auth/identities/:provider',
    method: 'DELETE',
    requiresAuth: true,
    consumer: 'services/auth/provider-auth-service.ts#unlinkAuthIdentity',
    requiredResponseFields: ['provider', 'canBeUnlinked'],
  },
];

/**
 * THE V1 AUTH ERROR VOCABULARY, and what this app does with each member.
 *
 * SCOPE: the codes reachable from the two REQUIRED V1 login methods (Google,
 * WhatsApp) plus the identity management they imply, and the two transport
 * codes every authenticated call can meet. Backend codes that belong to
 * surfaces V1 does not ship (payments, admin, media lifecycle) are
 * deliberately absent - see `V1_UNHANDLED_BACKEND_AUTH_CODES` for the ones
 * that are adjacent enough to be worth stating rather than leaving silent.
 *
 * A code listed `EXPLICIT` here has a dedicated `TranslationKey`; the
 * auth-error-contract test proves it, and proves that no two of them
 * collapse onto the same message by accident.
 */
export const V1_AUTH_ERROR_CONTRACT: readonly V1ErrorContractEntry[] = [
  {
    code: 'INVALID_GOOGLE_TOKEN',
    status: 401,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeGoogleLoginError',
    rationale:
      'One code covers every verification failure by design. It is EXPLICIT rather than ' +
      'generic because "the credential was rejected" and "Google is off on this server" ' +
      'need different advice, and only the second is fixable by an operator.',
  },
  {
    code: 'GOOGLE_AUTH_DISABLED',
    status: 503,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeGoogleLoginError',
    rationale:
      'A configuration state, not a credential state. Telling a viewer their Google account ' +
      'was rejected when the server simply has no Google configuration sends them to change ' +
      'a password that was never the problem.',
  },
  {
    code: 'AUTH_ACCOUNT_LINK_REQUIRED',
    status: 409,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeGoogleLoginError',
    rationale:
      'The account-takeover boundary of the whole provider phase. It is the one refusal with ' +
      'a real recovery path (sign in with the existing method, then link from Account ' +
      'Security), and a generic message would hide the only action that resolves it.',
  },
  {
    code: 'WHATSAPP_AUTH_DISABLED',
    status: 503,
    handling: 'EXPLICIT',
    surface:
      'features/auth/provider-error-messages.ts#describeOtpRequestError / describeOtpVerifyError',
    rationale:
      'Same reasoning as GOOGLE_AUTH_DISABLED. V1 ships WhatsApp Login, so a deployment that ' +
      'has not configured its Meta credentials must say so rather than look broken.',
  },
  {
    code: 'WHATSAPP_PROVIDER_UNAVAILABLE',
    status: 503,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeOtpRequestError',
    rationale:
      'Delivery definitively failed and NO challenge survives, so "try again" is true and ' +
      'immediate here where for a 429 it would be a lie. It also carries no per-number ' +
      'information, so reporting it specifically is not an enumeration oracle.',
  },
  {
    code: 'INVALID_PHONE_NUMBER',
    status: 400,
    handling: 'EXPLICIT',
    surface:
      'features/auth/provider-error-messages.ts#describeOtpRequestError / describeOtpVerifyError',
    rationale:
      'A pure input-shape refusal decided before any database read. The viewer can fix it, ' +
      'and it reveals nothing about which numbers have accounts.',
  },
  {
    code: 'INVALID_OTP',
    status: 401,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeOtpVerifyError',
    rationale:
      'EXPLICIT as a code, DELIBERATELY VAGUE as copy. One message covers wrong / expired / ' +
      'attempts-exhausted / already-used / no-such-challenge, because splitting them would ' +
      'tell an attacker whether guessing is making progress and would turn verify into a ' +
      'phone-number enumeration oracle. The message names what a person can act on and ' +
      'offers the action that resolves all five: request a new code.',
  },
  {
    code: 'OTP_RESEND_COOLDOWN',
    status: 429,
    handling: 'GENERIC',
    surface: 'features/auth/provider-error-messages.ts#describeOtpRequestError (429 branch)',
    rationale:
      'Folded into the shared 429 branch ON PURPOSE, and matched by STATUS rather than code: ' +
      'the per-IP route throttle produces the same wait with the generic HTTP_ERROR code, ' +
      'and it is the limiter an ordinary viewer actually reaches. The honest advice is ' +
      'identical for both, and a "next acceptance" estimate would read a number\'s recent ' +
      'request history back to the caller.',
  },
  {
    code: 'AUTH_IDENTITY_ALREADY_LINKED',
    status: 409,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeIdentityLinkError',
    rationale:
      'That identity belongs to a DIFFERENT account and is never transferred, so the fix is ' +
      'on the other account. Distinct copy from AUTH_PROVIDER_ALREADY_LINKED, which is a ' +
      'different fact with a different fix.',
  },
  {
    code: 'AUTH_PROVIDER_ALREADY_LINKED',
    status: 409,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeIdentityLinkError',
    rationale:
      'THIS account already holds a different identity for that provider. Nothing is wrong ' +
      'with the credential just proved; the account simply cannot hold two.',
  },
  {
    code: 'AUTH_LAST_IDENTITY',
    status: 409,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeUnlinkError',
    rationale:
      'Reachable even though the card hides the control, because a held list can be one ' +
      'action stale. The message must be the truthful "this is the only way in" and must ' +
      'never imply a retry would work.',
  },
  {
    code: 'AUTH_IDENTITY_NOT_FOUND',
    status: 404,
    handling: 'EXPLICIT',
    surface: 'features/auth/provider-error-messages.ts#describeUnlinkError',
    rationale:
      'Ownership-scoped, so it can never probe another account. Separated from the generic ' +
      'unlink failure so a stale list reads as stale rather than as a server fault.',
  },
  {
    code: 'INVALID_ACCESS_TOKEN',
    status: 401,
    handling: 'TRANSPORT',
    surface: 'services/api/client.ts (refresh-and-retry-once)',
    rationale:
      'Never a message. One refresh is attempted and the request retried once; a second ' +
      'failure clears the session. Rendering this as copy would show a viewer an error for ' +
      'something the app recovers from without them.',
  },
  {
    code: 'INVALID_REFRESH_TOKEN',
    status: 401,
    handling: 'TRANSPORT',
    surface: 'services/api/client.ts#runTokenRefresh (clears tokens, forces sign-out)',
    rationale:
      'The session is genuinely over. The app signs out rather than reporting a failure the ' +
      'viewer could retry, because there is nothing left to retry with.',
  },
  {
    code: 'HTTP_ERROR',
    status: 429,
    handling: 'GENERIC',
    surface: 'features/auth/provider-error-messages.ts (429 branch, matched by status)',
    rationale:
      'The framework-level throttle code. It carries no domain meaning at all, so it is ' +
      'matched by status and shares the cooldown copy. This is why every 429 branch in that ' +
      'module checks status BEFORE code.',
  },
];

/**
 * Backend auth codes this app knowingly does NOT map to provider copy, with
 * the reason. Stated rather than left silent so a future reader can tell
 * "considered and out of scope" from "overlooked".
 */
export const V1_UNHANDLED_BACKEND_AUTH_CODES: readonly {
  readonly code: string;
  readonly reason: string;
}[] = [
  {
    code: 'INVALID_CREDENTIALS',
    reason:
      'Belongs to the email/password surface, which V1 keeps but does not list as a required ' +
      'login method. It is handled where it is raised - app/login.tsx, app/account-security.tsx ' +
      'and app/account-data.tsx - not by the provider error module.',
  },
  {
    code: 'EMAIL_ALREADY_REGISTERED',
    reason: 'Registration surface only; handled in app/register.tsx.',
  },
  {
    code: 'USER_NOT_FOUND',
    reason:
      'The backend raises it only for an authenticated caller whose row vanished mid-request. ' +
      'It arrives as a plain failure and the session is already gone; there is no viewer ' +
      'action, so specific copy would only name a state nobody can fix.',
  },
  {
    code: 'ACCOUNT_DELETION_FORBIDDEN',
    reason: 'Account-deletion surface; handled in app/account-data.tsx, not a login path.',
  },
  {
    code: 'INVALID_PASSWORD_RESET_TOKEN',
    reason:
      'Password reset has no in-app completion screen in V1 - the backend ships no email ' +
      'delivery - so no V1 surface can receive this code.',
  },
];

/* -------------------------------------------------------------------------
 * REWARDS
 * ---------------------------------------------------------------------- */

export const V1_REWARDS_ENDPOINTS: readonly V1Endpoint[] = [
  {
    path: 'rewards/snapshot',
    method: 'GET',
    requiresAuth: true,
    consumer: 'services/rewards/rewards-service.ts#fetchRewardsSnapshot',
    requiredResponseFields: [
      'wallet',
      'dailyCheckIn',
      'watchTime',
      'tasks',
      'redemptions',
      'activePerks',
    ],
  },
  {
    path: 'rewards/check-in',
    method: 'POST',
    requiresAuth: true,
    consumer: 'services/rewards/rewards-service.ts#claimDailyCheckIn',
    requiredResponseFields: ['awardedPoints', 'alreadyCheckedIn', 'wallet', 'dailyCheckIn'],
  },
  {
    path: 'rewards/ledger',
    method: 'GET',
    requiresAuth: true,
    consumer: 'services/rewards/rewards-service.ts#fetchRewardsLedger',
    requiredResponseFields: ['entries', 'nextCursor'],
  },
  {
    path: 'rewards/redemptions',
    method: 'POST',
    requiresAuth: true,
    consumer: 'services/rewards/rewards-service.ts#redeemReward',
    requiredResponseFields: [
      'redemptionId',
      'offerId',
      'costPoints',
      'status',
      'replayed',
      'wallet',
      'perk',
    ],
  },
  {
    path: 'rewards/missions/:missionId/open',
    method: 'POST',
    requiresAuth: true,
    consumer: 'services/rewards/rewards-service.ts#openSocialMission',
    requiredResponseFields: ['missionId', 'destinationUrl', 'openedAt', 'claimableAfter', 'task'],
  },
  {
    path: 'rewards/missions/:missionId/claim',
    method: 'POST',
    requiresAuth: true,
    consumer: 'services/rewards/rewards-service.ts#claimMission',
    requiredResponseFields: ['missionId', 'awardedPoints', 'alreadyClaimed', 'wallet', 'task'],
  },
  {
    path: 'rewards/perks',
    method: 'GET',
    requiresAuth: true,
    consumer: 'services/rewards/rewards-service.ts#fetchActivePerks',
    requiredResponseFields: ['perks', 'skipNextInterstitial', 'adFreeUntil'],
  },
  {
    path: 'rewards/perks/:perkId/consume',
    method: 'POST',
    requiresAuth: true,
    consumer: 'services/rewards/rewards-service.ts#consumePerk',
    requiredResponseFields: ['perkId', 'consumed', 'alreadyConsumed', 'perks'],
  },
];

/**
 * The task types the V1 earn loop is specified to carry, and which of them
 * this build must be able to RENDER (as opposed to merely tolerate).
 *
 * `DAILY_CHECK_IN` is listed even though the snapshot's own `tasks[]` does
 * not currently contain one - the check-in lives in its own `dailyCheckIn`
 * block - because the type is part of the vocabulary and the mapper has copy
 * for it. `REWARDED_AD` and `CAMPAIGN` are served with
 * `isClaimSupported: false` and are renderable but not required.
 */
export const V1_RENDERABLE_TASK_TYPES: readonly string[] = [
  'DAILY_CHECK_IN',
  'SOCIAL_FOLLOW',
  'REWARDED_AD',
  'WATCH_TIME',
  'WATCH_EPISODES',
  'CAMPAIGN',
];

/** The earn concepts V1 REQUIRES to be present and claimable. */
export const V1_REQUIRED_EARN_CONCEPTS: readonly string[] = [
  'DAILY_CHECK_IN',
  'WATCH_EPISODES',
  'SOCIAL_FOLLOW',
];

/**
 * Social platforms. INSTAGRAM / TIKTOK / YOUTUBE carry `requiredForV1: true`
 * in the backend mission catalog; FACEBOOK deliberately does not, and a
 * release is never held up for a platform the product did not ask for.
 */
export const V1_REQUIRED_SOCIAL_PLATFORMS: readonly string[] = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE'];
export const V1_OPTIONAL_SOCIAL_PLATFORMS: readonly string[] = ['FACEBOOK'];

/** The perk types V1 sells for coins. Both are AD perks; neither grants premium. */
export const V1_PERK_TYPES: readonly string[] = ['SKIP_NEXT_INTERSTITIAL', 'TEMPORARY_AD_PASS'];

/* -------------------------------------------------------------------------
 * PLAYBACK
 * ---------------------------------------------------------------------- */

export const V1_PLAYBACK_ENDPOINTS: readonly V1Endpoint[] = [
  {
    path: 'videos/:id/playback',
    method: 'GET',
    requiresAuth: true,
    consumer: 'services/videos/video-service.ts#getPlaybackAuthorization',
    requiredResponseFields: ['expiresAt'],
  },
];

/**
 * Every field the client reads off ONE HLS rendition. A rendition missing
 * any of them makes the whole authorization fail its shape check rather than
 * being dropped from the ladder, because a partially populated ladder is a
 * backend partial-rollout state and silently playing around it hides the
 * drift.
 */
export const V1_HLS_RENDITION_FIELDS: readonly string[] = ['quality', 'width', 'height', 'url'];

/**
 * The backend's frozen rendition ladder. `1080p` is OPTIONAL by construction:
 * the transcoder never adds a rung above the source, so a portrait source
 * shot at 720 produces no 1080p entry and the quality menu must show none.
 */
export const V1_HLS_LADDER: readonly string[] = ['360p', '540p', '720p', '1080p'];
export const V1_HLS_GUARANTEED_RUNG = '360p';
export const V1_HLS_OPTIONAL_RUNG = '1080p';

/* -------------------------------------------------------------------------
 * THE PRODUCT POLICY
 * ---------------------------------------------------------------------- */

export type V1FeaturePosture = 'REQUIRED' | 'OPTIONAL' | 'OFF';

export interface V1FeaturePolicyEntry {
  readonly feature: string;
  readonly posture: V1FeaturePosture;
  /** The backend release-gate requirement id this mirrors, where one exists. */
  readonly backendContractId: string | null;
  /** What shipping the opposite posture actually does to the app. */
  readonly consequence: string;
}

/**
 * RED PANDA V1: free content + ads + rewards, signed in with Google or
 * WhatsApp, played over HLS. No payment, no subscription, no paywall, no
 * coin purchase.
 *
 * `backendContractId` names the matching entry in the backend's own
 * `V1_FEATURE_CONTRACT`, so the two halves of one release can be diffed by a
 * human in seconds. It is a REFERENCE, not an import: nothing here reads the
 * backend repository, and this app must stay buildable without it.
 */
export const V1_FEATURE_POLICY: readonly V1FeaturePolicyEntry[] = [
  {
    feature: 'Google Login',
    posture: 'REQUIRED',
    backendContractId: 'google-login',
    consequence:
      'the login screen ships a Google button that answers 503 GOOGLE_AUTH_DISABLED on every ' +
      'tap, or - worse, in a release build - is not rendered at all, so the method disappears ' +
      'silently instead of failing loudly.',
  },
  {
    feature: 'WhatsApp Login',
    posture: 'REQUIRED',
    backendContractId: 'whatsapp-login',
    consequence:
      'every /auth/whatsapp/* route answers 503 WHATSAPP_AUTH_DISABLED and the app ships with ' +
      'half its login screen dead.',
  },
  {
    feature: 'Rewards',
    posture: 'REQUIRED',
    backendContractId: 'rewards',
    consequence:
      'every /rewards/* route answers 503 REWARDS_DISABLED, no watch credit is recorded, and ' +
      'the app ships with no earn or spend loop at all.',
  },
  {
    feature: 'HLS playback',
    posture: 'REQUIRED',
    backendContractId: null,
    consequence:
      'resolvePlaybackSource returns null for every HLS-ready row - there is no client-side ' +
      'MP4 hidden inside an HLS response to fall back to - so those episodes render the ' +
      '"video unavailable" state instead of playing.',
  },
  {
    feature: 'Free content posture',
    posture: 'REQUIRED',
    backendContractId: 'free-catalog',
    consequence:
      'per-row access tiers are enforced, and because V1 ships no purchase flow at all, every ' +
      'episode marked premium becomes listed and permanently unplayable.',
  },
  {
    feature: 'Payments',
    posture: 'OFF',
    backendContractId: 'payments-disabled',
    consequence:
      'the /payments/* routes go live and the reward catalog stops suppressing its VIP offers ' +
      '- a purchase surface V1 is specified not to ship, and which no store listing or support ' +
      'process covers.',
  },
  {
    feature: 'Subscription',
    posture: 'OFF',
    backendContractId: null,
    consequence: 'V1 ships no recurring billing rail of any kind, and no screen to manage one.',
  },
  {
    feature: 'Premium paywall',
    posture: 'OFF',
    backendContractId: null,
    consequence:
      'a first-time viewer meets a Premium chip, an episode lock and an "Activate Premium" ' +
      'dead end in an app where nothing can be activated. Gated by ' +
      'services/config/v1-scope.ts#isPremiumExperienceEnabled.',
  },
  {
    feature: 'Coin purchase',
    posture: 'OFF',
    backendContractId: null,
    consequence:
      'points would become a currency the app sells, which needs a payment rail V1 does not ' +
      'ship and a store declaration nobody has made.',
  },
];

/** Convenience: the features a V1 release must actively provide. */
export const V1_REQUIRED_FEATURES: readonly string[] = V1_FEATURE_POLICY.filter(
  (entry) => entry.posture === 'REQUIRED'
).map((entry) => entry.feature);

/** Convenience: the features a V1 release must NOT expose. */
export const V1_FORBIDDEN_FEATURES: readonly string[] = V1_FEATURE_POLICY.filter(
  (entry) => entry.posture === 'OFF'
).map((entry) => entry.feature);
