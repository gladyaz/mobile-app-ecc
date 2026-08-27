/**
 * CANONICAL `/auth/*` WIRE PAYLOADS for the two REQUIRED V1 login methods.
 *
 * Copied field for field from the backend commit named in `provenance.ts`.
 * Typed with `satisfies` against this app's own mirrors (`@/types/auth`) so
 * the TYPE CHECKER is the first drift detector: if a mirror gains a required
 * field these stop compiling, and if a mirror loses one the parser tests
 * below start failing. Neither failure needs the backend repository present.
 *
 * VALUES ARE SYNTHETIC AND VISIBLY FAKE. See `provenance.ts` for why that is
 * a rule rather than a convention.
 */
import {
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_REFRESH_TOKEN,
  FIXTURE_USER_ID,
} from '@/services/contract/fixtures/provenance';
import type { AuthIdentitySummary, AuthResponse } from '@/types/auth';

/* -------------------------------------------------------------------------
 * SESSION RESPONSES - `POST /auth/google`, `/auth/whatsapp/otp/verify`,
 * `/auth/refresh`. All three answer the identical `AuthResponseDto`.
 * ---------------------------------------------------------------------- */

/**
 * A Google sign-in that resolved a verified email. `displayName` is present
 * because Google asserted a name; it is OPTIONAL on the wire and absent for
 * providers that assert none.
 */
export const GOOGLE_SIGN_IN_SUCCESS = {
  user: {
    id: FIXTURE_USER_ID,
    email: 'contract.fixture@example.invalid',
    displayName: 'Contract Fixture',
  },
  accessToken: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
} as const satisfies AuthResponse;

/**
 * A Google account whose token did NOT assert `email_verified`.
 *
 * `email` is `null` and the KEY IS STILL PRESENT - the contract decision
 * recorded on `AuthUser`. A client that treated a missing key and a null
 * value as the same thing would be reading a shape the backend never sends.
 */
export const GOOGLE_SIGN_IN_UNVERIFIED_EMAIL = {
  user: {
    id: 'usr_contract_fixture_no_email',
    email: null,
  },
  accessToken: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
} as const satisfies AuthResponse;

/**
 * A WhatsApp-only account. It has no email AT ALL - the backend never invents
 * a synthetic `+62...@whatsapp.local` address, and nor may this client. The
 * human-readable label for such an account is the MASKED `identifier` on
 * `GET /auth/identities`.
 */
export const WHATSAPP_VERIFY_SUCCESS = {
  user: {
    id: 'usr_contract_fixture_phone_only',
    email: null,
  },
  accessToken: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
} as const satisfies AuthResponse;

/** `POST /auth/refresh` - a rotated pair plus the (possibly updated) user. */
export const REFRESH_SUCCESS = {
  user: {
    id: FIXTURE_USER_ID,
    email: 'contract.fixture@example.invalid',
    displayName: 'Contract Fixture',
  },
  accessToken: 'fixture.access.token.rotated-not-a-real-jwt',
  refreshToken: 'fixture-refresh-token-rotated-not-a-real-secret',
} as const satisfies AuthResponse;

/* -------------------------------------------------------------------------
 * MALFORMED SESSION RESPONSES
 *
 * Deliberately typed `unknown`: each one VIOLATES the mirror, which is the
 * whole point, and typing them any other way would make the type checker
 * refuse to hold the evidence. Each models a real backend drift, not a
 * hypothetical one.
 * ---------------------------------------------------------------------- */

/**
 * The drift with teeth. Persisting this would put `undefined` in the
 * Keystore under `refreshToken`, leave the app looking signed in, and force
 * a silent sign-out at the first 401 - with no error anywhere.
 */
export const SESSION_MISSING_REFRESH_TOKEN: unknown = {
  user: { id: FIXTURE_USER_ID, email: 'contract.fixture@example.invalid' },
  accessToken: FIXTURE_ACCESS_TOKEN,
};

/** A rename of `accessToken` - the shape a v2 API might arrive with. */
export const SESSION_RENAMED_ACCESS_TOKEN: unknown = {
  user: { id: FIXTURE_USER_ID, email: 'contract.fixture@example.invalid' },
  token: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
};

/** No user block at all. Everything downstream reads `user.id`. */
export const SESSION_MISSING_USER: unknown = {
  accessToken: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
};

/** A user with no id. `id` is what every identity-scoped store keys on. */
export const SESSION_MISSING_USER_ID: unknown = {
  user: { email: 'contract.fixture@example.invalid' },
  accessToken: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
};

/**
 * `email` omitted rather than sent as `null`. The contract says the KEY IS
 * ALWAYS PRESENT, so this is drift - but it is the one malformed case where
 * the safe reading is unambiguous, and the parser must still refuse it
 * rather than quietly inventing `null`.
 */
export const SESSION_OMITTED_EMAIL_KEY: unknown = {
  user: { id: FIXTURE_USER_ID },
  accessToken: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
};

/** A non-string token. TypeScript cannot see this one at runtime. */
export const SESSION_NON_STRING_TOKEN: unknown = {
  user: { id: FIXTURE_USER_ID, email: null },
  accessToken: 12345,
  refreshToken: FIXTURE_REFRESH_TOKEN,
};

/** An empty access token. Structurally a string, operationally useless. */
export const SESSION_EMPTY_ACCESS_TOKEN: unknown = {
  user: { id: FIXTURE_USER_ID, email: null },
  accessToken: '',
  refreshToken: FIXTURE_REFRESH_TOKEN,
};

/** Not an object at all - what a proxy error page or an HTML 502 parses to. */
export const SESSION_NOT_AN_OBJECT: unknown = 'signed in';

/**
 * A session response carrying fields this build has never heard of. It MUST
 * be accepted: the backend adds fields additively, and a client that refused
 * an unknown key would break on every future release.
 */
export const SESSION_WITH_UNKNOWN_EXTRA_FIELDS: unknown = {
  user: {
    id: FIXTURE_USER_ID,
    email: 'contract.fixture@example.invalid',
    displayName: 'Contract Fixture',
    avatarUrl: 'https://cdn.example.invalid/avatar.png',
    locale: 'id-ID',
  },
  accessToken: FIXTURE_ACCESS_TOKEN,
  refreshToken: FIXTURE_REFRESH_TOKEN,
  accessTokenExpiresIn: 900,
};

/* -------------------------------------------------------------------------
 * WHATSAPP OTP REQUEST - `POST /auth/whatsapp/otp/request`, 202.
 *
 * The wire payload carries `success`, which the normalized `OtpChallenge`
 * does not, so these are raw records rather than `satisfies OtpChallenge`.
 * Values are the backend's public constants: OTP_TTL_MS = 5 min,
 * OTP_RESEND_COOLDOWN_MS = 60 s.
 * ---------------------------------------------------------------------- */

export const OTP_REQUEST_SUCCESS = {
  success: true,
  expiresInSeconds: 300,
  resendAvailableInSeconds: 60,
} as const;

/**
 * The same response from a server running with `DEV_TOOLS_ENABLED=true`.
 * `devCode` can never appear in production, and the client must neither
 * require it nor choke on it.
 */
export const OTP_REQUEST_SUCCESS_WITH_DEV_CODE = {
  success: true,
  expiresInSeconds: 300,
  resendAvailableInSeconds: 60,
  devCode: '000000',
} as const;

/**
 * The regression this parser was written for: an absent
 * `resendAvailableInSeconds` produced `NaN`, a countdown that never reached
 * zero, and a permanently disabled resend button - a dead end for the viewer
 * from a payload TypeScript was perfectly happy with.
 */
export const OTP_REQUEST_MISSING_RESEND: unknown = {
  success: true,
  expiresInSeconds: 300,
};

export const OTP_REQUEST_NON_NUMERIC_RESEND: unknown = {
  success: true,
  expiresInSeconds: 300,
  resendAvailableInSeconds: '60',
};

export const OTP_REQUEST_NOT_SUCCESS: unknown = {
  expiresInSeconds: 300,
  resendAvailableInSeconds: 60,
};

export const OTP_REQUEST_NOT_AN_OBJECT: unknown = null;

/* -------------------------------------------------------------------------
 * IDENTITY LIST - `GET /auth/identities` and the body every link/unlink
 * call returns.
 * ---------------------------------------------------------------------- */

/**
 * An account with all three providers attached. `identifier` is the SAFE
 * rendering the backend chose: the email for `email`/`google`, a phone
 * masked to its last four digits for `whatsapp`. A raw `providerSubject` is
 * never on the wire.
 */
export const AUTH_IDENTITIES_ALL_THREE = [
  {
    provider: 'email',
    identifier: 'contract.fixture@example.invalid',
    usable: true,
    canBeUnlinked: false,
    createdAt: '2026-08-01T02:00:00.000Z',
    verifiedAt: null,
  },
  {
    provider: 'google',
    identifier: 'contract.fixture@example.invalid',
    usable: true,
    canBeUnlinked: true,
    createdAt: '2026-08-10T04:30:00.000Z',
    verifiedAt: '2026-08-10T04:30:00.000Z',
  },
  {
    provider: 'whatsapp',
    identifier: '+*******7890',
    usable: true,
    canBeUnlinked: true,
    createdAt: '2026-08-12T09:15:00.000Z',
    verifiedAt: '2026-08-12T09:15:00.000Z',
  },
] as const satisfies readonly AuthIdentitySummary[];

/**
 * A WhatsApp-only account: one identity, and the server has already computed
 * that it cannot be removed. `canBeUnlinked` is AUTHORITATIVE - the client
 * renders its button off this flag rather than re-deriving the rule.
 */
export const AUTH_IDENTITIES_WHATSAPP_ONLY = [
  {
    provider: 'whatsapp',
    identifier: '+*******7890',
    usable: true,
    canBeUnlinked: false,
    createdAt: '2026-08-12T09:15:00.000Z',
    verifiedAt: '2026-08-12T09:15:00.000Z',
  },
] as const satisfies readonly AuthIdentitySummary[];

/**
 * A FUTURE PROVIDER this build has never heard of, beside one it has.
 *
 * The list must survive: dropping the whole payload would take out the
 * identity the client CAN render along with the one it cannot. Typed
 * `unknown` because `provider` is outside the closed `AuthProviderId` union
 * on purpose - that is exactly the drift being modelled.
 */
export const AUTH_IDENTITIES_WITH_FUTURE_PROVIDER: unknown = [
  {
    provider: 'google',
    identifier: 'contract.fixture@example.invalid',
    usable: true,
    canBeUnlinked: true,
    createdAt: '2026-08-10T04:30:00.000Z',
    verifiedAt: '2026-08-10T04:30:00.000Z',
  },
  {
    provider: 'apple',
    identifier: 'contract.fixture@privaterelay.example.invalid',
    usable: true,
    canBeUnlinked: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    verifiedAt: '2026-09-01T00:00:00.000Z',
  },
];

/** A missing `canBeUnlinked` would read as "not unlinkable" - safe, but silent. */
export const AUTH_IDENTITIES_MISSING_CAN_BE_UNLINKED: unknown = [
  {
    provider: 'google',
    identifier: 'contract.fixture@example.invalid',
    usable: true,
    createdAt: '2026-08-10T04:30:00.000Z',
    verifiedAt: '2026-08-10T04:30:00.000Z',
  },
];

export const AUTH_IDENTITIES_NOT_AN_ARRAY: unknown = {
  identities: [],
};
