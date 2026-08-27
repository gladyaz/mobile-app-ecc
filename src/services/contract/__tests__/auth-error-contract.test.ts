/**
 * V1 AUTH ERROR-CODE LOCK.
 *
 * The backend's `AppErrorCode` enum is large and most of it belongs to
 * surfaces V1 does not ship. What matters is the SUBSET the two required
 * login methods can produce, and that this app has a defined, deliberate
 * reaction to every member of it.
 *
 * THE BAR IS NOT "DOES NOT CRASH". A required refusal rendered as an
 * unexplained "gagal" is a dead end a viewer cannot act on, which is why
 * `V1_AUTH_ERROR_CONTRACT` classifies each code as EXPLICIT / GENERIC /
 * TRANSPORT and this suite proves the classification is true of the code
 * that actually runs.
 *
 * IT DELIBERATELY DOES NOT force every backend code into UI copy. The
 * `IGNORED` half is stated in `V1_UNHANDLED_BACKEND_AUTH_CODES` with a
 * reason, so "considered and out of scope" is distinguishable from
 * "overlooked".
 */
import {
  describeGoogleLoginError,
  describeIdentityLinkError,
  describeOtpRequestError,
  describeOtpVerifyError,
  describeUnlinkError,
} from '@/features/auth/provider-error-messages';
import { ApiError } from '@/services/api/client';
import {
  V1_AUTH_ERROR_CONTRACT,
  V1_UNHANDLED_BACKEND_AUTH_CODES,
} from '@/services/contract/v1-contract-manifest';
import type { TranslationKey } from '@/services/i18n/translations';

/** Every describe* function has this shape, so they can be swept uniformly. */
type Describer = (error: unknown) => TranslationKey;

const DESCRIBERS: readonly { readonly name: string; readonly describe: Describer }[] = [
  { name: 'describeGoogleLoginError', describe: describeGoogleLoginError },
  { name: 'describeOtpRequestError', describe: describeOtpRequestError },
  { name: 'describeOtpVerifyError', describe: describeOtpVerifyError },
  { name: 'describeUnlinkError', describe: describeUnlinkError },
  {
    name: 'describeIdentityLinkError(google)',
    describe: (error) => describeIdentityLinkError(error, 'google'),
  },
  {
    name: 'describeIdentityLinkError(whatsapp)',
    describe: (error) => describeIdentityLinkError(error, 'whatsapp'),
  },
];

function apiError(code: string, status: number): ApiError {
  return new ApiError(status, code, 'contract fixture');
}

/**
 * The message a describer produces for a code it has no branch for. Used as
 * the yardstick for "was this code actually handled EXPLICITLY, or did it
 * just fall through?"
 */
function fallbackFor(describe: Describer): TranslationKey {
  return describe(apiError('A_CODE_NO_BRANCH_EXISTS_FOR', 418));
}

describe('the V1 auth error contract is well-formed', () => {
  it('lists each code once, with a status, a named surface and a real rationale', () => {
    const codes = V1_AUTH_ERROR_CONTRACT.map((entry) => entry.code);

    expect(new Set(codes).size).toBe(codes.length);

    V1_AUTH_ERROR_CONTRACT.forEach((entry) => {
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.surface).toMatch(/\.ts/);
      // Long enough that it had to say something. A one-word rationale is
      // how a policy table quietly becomes a list of codes.
      expect(entry.rationale.length).toBeGreaterThan(60);
    });
  });

  it('never lists a code as both handled and knowingly unhandled', () => {
    const handled = new Set(V1_AUTH_ERROR_CONTRACT.map((entry) => entry.code));
    const unhandled = V1_UNHANDLED_BACKEND_AUTH_CODES.map((entry) => entry.code);

    unhandled.forEach((code) => expect(handled.has(code)).toBe(false));
  });

  it('gives every knowingly-unhandled code a stated reason', () => {
    V1_UNHANDLED_BACKEND_AUTH_CODES.forEach((entry) => {
      expect(entry.reason.length).toBeGreaterThan(40);
    });
  });
});

describe('every EXPLICIT code produces its own message on its own surface', () => {
  const explicit = V1_AUTH_ERROR_CONTRACT.filter((entry) => entry.handling === 'EXPLICIT');

  it.each(explicit.map((entry) => [entry.code, entry.status] as const))(
    '%s is answered specifically by at least one describer',
    (code, status) => {
      const error = apiError(code, status);

      const specific = DESCRIBERS.filter(
        ({ describe }) => describe(error) !== fallbackFor(describe)
      );

      expect(specific.length).toBeGreaterThan(0);
    }
  );

  it('separates the two link conflicts, which are different facts with different fixes', () => {
    const ownedByAnother = describeIdentityLinkError(
      apiError('AUTH_IDENTITY_ALREADY_LINKED', 409),
      'google'
    );
    const alreadyHaveOne = describeIdentityLinkError(
      apiError('AUTH_PROVIDER_ALREADY_LINKED', 409),
      'google'
    );

    expect(ownedByAnother).not.toBe(alreadyHaveOne);
  });

  it('separates a rejected Google credential from Google being switched off', () => {
    expect(describeGoogleLoginError(apiError('INVALID_GOOGLE_TOKEN', 401))).not.toBe(
      describeGoogleLoginError(apiError('GOOGLE_AUTH_DISABLED', 503))
    );
  });

  it('separates a delivery outage from the provider being switched off', () => {
    // Different advice: no challenge survives WHATSAPP_PROVIDER_UNAVAILABLE,
    // so "try again" is true and immediate. It is not for a disabled server.
    expect(describeOtpRequestError(apiError('WHATSAPP_PROVIDER_UNAVAILABLE', 503))).not.toBe(
      describeOtpRequestError(apiError('WHATSAPP_AUTH_DISABLED', 503))
    );
  });

  it('points AUTH_ACCOUNT_LINK_REQUIRED at the recovery path instead of a generic failure', () => {
    const collision = describeGoogleLoginError(apiError('AUTH_ACCOUNT_LINK_REQUIRED', 409));

    expect(collision).not.toBe(fallbackFor(describeGoogleLoginError));
    expect(collision).toBe('login.googleLinkRequired');
  });

  it('reports AUTH_LAST_IDENTITY as the truthful last-method refusal', () => {
    expect(describeUnlinkError(apiError('AUTH_LAST_IDENTITY', 409))).toBe(
      'authMethods.lastMethod'
    );
  });
});

describe('every GENERIC code is folded on purpose, not by accident', () => {
  it('matches OTP_RESEND_COOLDOWN by STATUS, so the per-IP throttle lands on the same copy', () => {
    // The per-IP route throttle carries the framework's generic HTTP_ERROR
    // and is the limiter an ordinary viewer actually reaches, so a
    // code-first branch would miss it entirely.
    const perNumber = describeOtpRequestError(apiError('OTP_RESEND_COOLDOWN', 429));
    const perIp = describeOtpRequestError(apiError('HTTP_ERROR', 429));

    expect(perNumber).toBe(perIp);
    expect(perNumber).toBe('whatsapp.tooManyRequests');
  });

  it('keeps the verify throttle distinct from a rejected code - waiting is the only thing that helps', () => {
    expect(describeOtpVerifyError(apiError('HTTP_ERROR', 429))).not.toBe(
      describeOtpVerifyError(apiError('INVALID_OTP', 401))
    );
  });

  it('gives INVALID_OTP exactly ONE message for all six causes it covers', () => {
    // Wrong / expired / attempts exhausted / already used / no challenge /
    // lost the single-use race. Splitting them client-side would invent a
    // distinction the server refuses to make, and turn verify into a
    // phone-number enumeration oracle.
    const message = describeOtpVerifyError(apiError('INVALID_OTP', 401));

    expect(message).toBe('whatsapp.otpRejected');
    expect(describeIdentityLinkError(apiError('INVALID_OTP', 401), 'whatsapp')).toBe(message);
  });
});

describe('an unknown or future code fails gracefully on every surface', () => {
  it.each(DESCRIBERS.map((entry) => [entry.name, entry.describe] as const))(
    '%s answers with a real translation key for a code it has never seen',
    (_name, describe) => {
      const future = describe(apiError('AUTH_PASSKEY_REQUIRED', 409));

      expect(typeof future).toBe('string');
      expect(future.length).toBeGreaterThan(0);
      expect(future).toBe(fallbackFor(describe));
    }
  );

  it.each(DESCRIBERS.map((entry) => [entry.name, entry.describe] as const))(
    '%s survives a non-ApiError - a thrown string, a null, a bare Error',
    (_name, describe) => {
      expect(() => describe(new Error('network went away'))).not.toThrow();
      expect(() => describe('not an error at all')).not.toThrow();
      expect(() => describe(null)).not.toThrow();
      expect(() => describe(undefined)).not.toThrow();
    }
  );

  it('never answers a code the backend deliberately refuses to be specific about with an invented reason', () => {
    // There must be no branch anywhere that distinguishes an expired OTP
    // from a wrong one, however tempting the UX would be.
    const messages = DESCRIBERS.map(({ describe }) =>
      describe(apiError('INVALID_OTP', 401))
    ).filter((message, index, all) => all.indexOf(message) === index);

    // Exactly two: the OTP message on the surfaces that meet the code, and
    // each other surface's own fallback. Never a third, more specific one.
    expect(messages).toContain('whatsapp.otpRejected');
    expect(messages).not.toContain('whatsapp.otpExpired');
    expect(messages).not.toContain('whatsapp.otpAttemptsExhausted');
  });
});

describe('the TRANSPORT codes are never turned into user-facing copy', () => {
  const transport = V1_AUTH_ERROR_CONTRACT.filter((entry) => entry.handling === 'TRANSPORT');

  it('covers exactly the two session-lifecycle codes', () => {
    expect(transport.map((entry) => entry.code).sort()).toEqual([
      'INVALID_ACCESS_TOKEN',
      'INVALID_REFRESH_TOKEN',
    ]);
  });

  it.each(transport.map((entry) => [entry.code, entry.status] as const))(
    '%s falls through every provider describer to its generic branch',
    (code, status) => {
      const error = apiError(code, status);

      DESCRIBERS.forEach(({ describe }) => {
        expect(describe(error)).toBe(fallbackFor(describe));
      });
    }
  );
});
