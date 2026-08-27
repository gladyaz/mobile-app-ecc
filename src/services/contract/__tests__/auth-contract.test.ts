/**
 * V1 AUTH CONTRACT LOCK.
 *
 * Feeds the canonical `/auth/*` payloads from `fixtures/auth-fixtures.ts`
 * through the REAL client parsers and asserts the app both accepts what the
 * backend actually sends and refuses what it does not.
 *
 * WHY THIS SITS BESIDE `provider-auth-service.test.ts` RATHER THAN INSIDE IT.
 * That suite tests the SERVICE - which route, which body, which header. This
 * one tests the CONTRACT - which shapes are admissible at all - from a single
 * checked-in fixture set that carries its own backend provenance. The two
 * fail for different reasons: a routing regression breaks that suite, a
 * backend drift breaks this one.
 */
import { ApiError, request } from '@/services/api/client';
import {
  listAuthIdentities,
  loginWithGoogleIdToken,
  startWhatsAppOtp,
  verifyWhatsAppOtp,
} from '@/services/auth/provider-auth-service';
import {
  AUTH_IDENTITIES_ALL_THREE,
  AUTH_IDENTITIES_MISSING_CAN_BE_UNLINKED,
  AUTH_IDENTITIES_NOT_AN_ARRAY,
  AUTH_IDENTITIES_WHATSAPP_ONLY,
  AUTH_IDENTITIES_WITH_FUTURE_PROVIDER,
  GOOGLE_SIGN_IN_SUCCESS,
  GOOGLE_SIGN_IN_UNVERIFIED_EMAIL,
  OTP_REQUEST_MISSING_RESEND,
  OTP_REQUEST_NON_NUMERIC_RESEND,
  OTP_REQUEST_NOT_AN_OBJECT,
  OTP_REQUEST_NOT_SUCCESS,
  OTP_REQUEST_SUCCESS,
  OTP_REQUEST_SUCCESS_WITH_DEV_CODE,
  SESSION_EMPTY_ACCESS_TOKEN,
  SESSION_MISSING_REFRESH_TOKEN,
  SESSION_MISSING_USER,
  SESSION_MISSING_USER_ID,
  SESSION_NON_STRING_TOKEN,
  SESSION_NOT_AN_OBJECT,
  SESSION_OMITTED_EMAIL_KEY,
  SESSION_RENAMED_ACCESS_TOKEN,
  SESSION_WITH_UNKNOWN_EXTRA_FIELDS,
  WHATSAPP_VERIFY_SUCCESS,
} from '@/services/contract/fixtures/auth-fixtures';
import { V1_AUTH_ENDPOINTS } from '@/services/contract/v1-contract-manifest';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return { ...actual, request: jest.fn() };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

/** Every session parser refuses the same way, so assert it the same way. */
async function expectInvalidResponse(run: () => Promise<unknown>): Promise<void> {
  await expect(run()).rejects.toBeInstanceOf(ApiError);
  await expect(run()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
}

describe('Google sign-in wire contract', () => {
  it('accepts the canonical success payload and hands back the session verbatim', async () => {
    mockedRequest.mockResolvedValue(GOOGLE_SIGN_IN_SUCCESS);

    await expect(loginWithGoogleIdToken('google-id-token')).resolves.toEqual({
      user: {
        id: 'usr_contract_fixture',
        email: 'contract.fixture@example.invalid',
        displayName: 'Contract Fixture',
      },
      accessToken: 'fixture.access.token.not-a-real-jwt',
      refreshToken: 'fixture-refresh-token-not-a-real-secret',
    });
  });

  it('accepts a Google account whose token asserted no verified email', async () => {
    mockedRequest.mockResolvedValue(GOOGLE_SIGN_IN_UNVERIFIED_EMAIL);

    const session = await loginWithGoogleIdToken('google-id-token');

    // Present AND null. A consumer destructures unconditionally; only the
    // TYPE has to admit null.
    expect(session.user).toHaveProperty('email');
    expect(session.user.email).toBeNull();
  });

  it('requires both halves of the token pair', async () => {
    mockedRequest.mockResolvedValue(SESSION_MISSING_REFRESH_TOKEN);

    await expectInvalidResponse(() => loginWithGoogleIdToken('google-id-token'));
  });

  it('refuses a renamed access token rather than signing in with nothing', async () => {
    mockedRequest.mockResolvedValue(SESSION_RENAMED_ACCESS_TOKEN);

    await expectInvalidResponse(() => loginWithGoogleIdToken('google-id-token'));
  });

  it('refuses a session with no user, and one whose user has no id', async () => {
    mockedRequest.mockResolvedValue(SESSION_MISSING_USER);
    await expectInvalidResponse(() => loginWithGoogleIdToken('google-id-token'));

    mockedRequest.mockResolvedValue(SESSION_MISSING_USER_ID);
    await expectInvalidResponse(() => loginWithGoogleIdToken('google-id-token'));
  });

  it('refuses an OMITTED email key instead of quietly reading it as null', async () => {
    // The contract says the key is always present. Substituting `null` here
    // would absorb exactly the drift this lock exists to surface.
    mockedRequest.mockResolvedValue(SESSION_OMITTED_EMAIL_KEY);

    await expectInvalidResponse(() => loginWithGoogleIdToken('google-id-token'));
  });

  it('refuses a non-string token and an empty one alike', async () => {
    mockedRequest.mockResolvedValue(SESSION_NON_STRING_TOKEN);
    await expectInvalidResponse(() => loginWithGoogleIdToken('google-id-token'));

    mockedRequest.mockResolvedValue(SESSION_EMPTY_ACCESS_TOKEN);
    await expectInvalidResponse(() => loginWithGoogleIdToken('google-id-token'));
  });

  it('refuses a non-object payload - an HTML error page, a bare string', async () => {
    mockedRequest.mockResolvedValue(SESSION_NOT_AN_OBJECT);

    await expectInvalidResponse(() => loginWithGoogleIdToken('google-id-token'));
  });

  it('TOLERATES unknown extra fields, because the backend adds them additively', async () => {
    mockedRequest.mockResolvedValue(SESSION_WITH_UNKNOWN_EXTRA_FIELDS);

    const session = await loginWithGoogleIdToken('google-id-token');

    expect(session.accessToken).toBe('fixture.access.token.not-a-real-jwt');
    expect(session.user.id).toBe('usr_contract_fixture');
  });

  it('never echoes the payload into the thrown message - it is made of credentials', async () => {
    mockedRequest.mockResolvedValue(SESSION_MISSING_REFRESH_TOKEN);

    await expect(loginWithGoogleIdToken('google-id-token')).rejects.toThrow(
      /returned a session payload with an invalid shape/
    );
    await expect(loginWithGoogleIdToken('google-id-token')).rejects.not.toThrow(
      /fixture\.access\.token/
    );
  });
});

describe('WhatsApp OTP request wire contract', () => {
  it('accepts the canonical 202 payload and returns only the two timing constants', async () => {
    mockedRequest.mockResolvedValue(OTP_REQUEST_SUCCESS);

    const challenge = await startWhatsAppOtp('+6281234567890');

    expect(challenge).toEqual({ expiresInSeconds: 300, resendAvailableInSeconds: 60 });
  });

  it('carries NOTHING that could reveal whether the number has an account', async () => {
    mockedRequest.mockResolvedValue(OTP_REQUEST_SUCCESS);

    const challenge = await startWhatsAppOtp('+6281234567890');

    // An anti-enumeration property, asserted structurally: the returned
    // object has exactly two keys and neither is an existence signal.
    expect(Object.keys(challenge).sort()).toEqual([
      'expiresInSeconds',
      'resendAvailableInSeconds',
    ]);
  });

  it('accepts a dev-tools build response without requiring or leaking devCode', async () => {
    mockedRequest.mockResolvedValue(OTP_REQUEST_SUCCESS_WITH_DEV_CODE);

    const challenge = await startWhatsAppOtp('+6281234567890');

    expect(challenge).toEqual({ expiresInSeconds: 300, resendAvailableInSeconds: 60 });
    expect(challenge).not.toHaveProperty('devCode');
  });

  it('rejects the missing resend countdown that once produced a permanently disabled button', async () => {
    mockedRequest.mockResolvedValue(OTP_REQUEST_MISSING_RESEND);

    await expectInvalidResponse(() => startWhatsAppOtp('+6281234567890'));
  });

  it('rejects a stringified countdown, a missing success flag, and a non-object', async () => {
    mockedRequest.mockResolvedValue(OTP_REQUEST_NON_NUMERIC_RESEND);
    await expectInvalidResponse(() => startWhatsAppOtp('+6281234567890'));

    mockedRequest.mockResolvedValue(OTP_REQUEST_NOT_SUCCESS);
    await expectInvalidResponse(() => startWhatsAppOtp('+6281234567890'));

    mockedRequest.mockResolvedValue(OTP_REQUEST_NOT_AN_OBJECT);
    await expectInvalidResponse(() => startWhatsAppOtp('+6281234567890'));
  });
});

describe('WhatsApp OTP verify wire contract', () => {
  it('accepts the canonical session for a phone-only account with no email at all', async () => {
    mockedRequest.mockResolvedValue(WHATSAPP_VERIFY_SUCCESS);

    const session = await verifyWhatsAppOtp('+6281234567890', '123456');

    expect(session.user.email).toBeNull();
    expect(session.accessToken).toBe('fixture.access.token.not-a-real-jwt');
    expect(session.refreshToken).toBe('fixture-refresh-token-not-a-real-secret');
  });

  it('applies the SAME session validation as the Google route - one contract, one check', async () => {
    mockedRequest.mockResolvedValue(SESSION_MISSING_REFRESH_TOKEN);

    await expectInvalidResponse(() => verifyWhatsAppOtp('+6281234567890', '123456'));
  });
});

describe('identity list wire contract', () => {
  it('parses the canonical three-provider list, masked phone included', async () => {
    mockedRequest.mockResolvedValue(AUTH_IDENTITIES_ALL_THREE);

    const identities = await listAuthIdentities();

    expect(identities).toHaveLength(3);
    expect(identities.map((identity) => identity.provider)).toEqual([
      'email',
      'google',
      'whatsapp',
    ]);
    // The SAFE rendering, never a raw providerSubject.
    expect(identities[2].identifier).toBe('+*******7890');
    expect(identities.every((identity) => !('providerSubject' in identity))).toBe(true);
  });

  it('carries the server-computed canBeUnlinked verdict through untouched', async () => {
    mockedRequest.mockResolvedValue(AUTH_IDENTITIES_WHATSAPP_ONLY);

    const [only] = await listAuthIdentities();

    // AUTHORITATIVE. The client renders its unlink control off this flag
    // rather than re-deriving the last-method rule.
    expect(only.canBeUnlinked).toBe(false);
  });

  it('keeps a FUTURE provider in the list rather than discarding the whole payload', async () => {
    mockedRequest.mockResolvedValue(AUTH_IDENTITIES_WITH_FUTURE_PROVIDER);

    const identities = await listAuthIdentities();

    expect(identities).toHaveLength(2);
    expect(identities.map((identity) => identity.provider)).toContain('apple');
  });

  it('refuses an entry missing the authoritative flag, and a payload that is not an array', async () => {
    mockedRequest.mockResolvedValue(AUTH_IDENTITIES_MISSING_CAN_BE_UNLINKED);
    await expectInvalidResponse(() => listAuthIdentities());

    mockedRequest.mockResolvedValue(AUTH_IDENTITIES_NOT_AN_ARRAY);
    await expectInvalidResponse(() => listAuthIdentities());
  });
});

describe('the auth endpoint manifest matches the routes the client actually calls', () => {
  it('sends the unauthenticated login routes with no bearer token', async () => {
    mockedRequest.mockResolvedValue(GOOGLE_SIGN_IN_SUCCESS);
    await loginWithGoogleIdToken('google-id-token');

    const [path, , config] = mockedRequest.mock.calls[0];

    expect(path).toBe('auth/google');
    expect(config?.requiresAuth).toBeUndefined();
  });

  it('sends the identity routes authenticated', async () => {
    mockedRequest.mockResolvedValue(AUTH_IDENTITIES_ALL_THREE);
    await listAuthIdentities();

    const [path, , config] = mockedRequest.mock.calls[0];

    expect(path).toBe('auth/identities');
    expect(config).toEqual({ requiresAuth: true });
  });

  it('declares every V1 auth endpoint exactly once, with a named owning module', () => {
    const paths = V1_AUTH_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`);

    expect(new Set(paths).size).toBe(paths.length);
    expect(
      V1_AUTH_ENDPOINTS.every(
        (endpoint) => endpoint.consumer.includes('.ts#') && endpoint.requiredResponseFields.length > 0
      )
    ).toBe(true);
  });

  it('requires the full token pair AND a user identity on every session route', () => {
    const sessionRoutes = V1_AUTH_ENDPOINTS.filter((endpoint) =>
      endpoint.requiredResponseFields.includes('accessToken')
    );

    // Google, WhatsApp verify and refresh. If a fourth ever issues a session,
    // it has to appear here too.
    expect(sessionRoutes).toHaveLength(3);
    sessionRoutes.forEach((endpoint) => {
      expect(endpoint.requiredResponseFields).toEqual(
        expect.arrayContaining(['accessToken', 'refreshToken', 'user.id', 'user.email'])
      );
    });
  });
});
