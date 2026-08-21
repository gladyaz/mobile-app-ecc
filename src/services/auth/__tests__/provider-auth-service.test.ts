import { request } from '@/services/api/client';
import {
  linkGoogleIdentity,
  linkWhatsAppIdentity,
  listAuthIdentities,
  loginWithGoogleIdToken,
  startWhatsAppOtp,
  unlinkAuthIdentity,
  verifyWhatsAppOtp,
} from '@/services/auth/provider-auth-service';
import type { AuthIdentitySummary, AuthResponse, OtpChallenge } from '@/types/auth';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return {
    ...actual,
    request: jest.fn(),
  };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function buildAuthResponse(): AuthResponse {
  return {
    user: { id: 'user_1', email: 'jane@example.com' },
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
  };
}

/** The canonical `POST /auth/whatsapp/otp/request` body. */
function buildChallengePayload(overrides?: Record<string, unknown>) {
  return { success: true, expiresInSeconds: 300, resendAvailableInSeconds: 60, ...overrides };
}

function buildIdentity(overrides?: Partial<AuthIdentitySummary>): AuthIdentitySummary {
  return {
    provider: 'email',
    identifier: 'jane@example.com',
    usable: true,
    canBeUnlinked: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    verifiedAt: null,
    ...overrides,
  };
}

describe('loginWithGoogleIdToken', () => {
  it('posts the ID token to the canonical route and resolves with the app own session tokens', async () => {
    const authResponse = buildAuthResponse();
    mockedRequest.mockResolvedValueOnce(authResponse);

    const result = await loginWithGoogleIdToken('google-id-token');

    expect(result).toEqual(authResponse);
    expect(mockedRequest).toHaveBeenCalledWith('auth/google', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ idToken: 'google-id-token' }),
    });
  });

  it('sends the ID token and NOTHING else', async () => {
    // The backend's whitelisting ValidationPipe rejects any extra field with
    // a 400, so a client can never hint at an email or a subject.
    mockedRequest.mockResolvedValueOnce(buildAuthResponse());

    await loginWithGoogleIdToken('google-id-token');

    const body = JSON.parse(String(mockedRequest.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['idToken']);
  });

  it('is unauthenticated: it must not attach the (nonexistent) access token', async () => {
    mockedRequest.mockResolvedValueOnce(buildAuthResponse());

    await loginWithGoogleIdToken('google-id-token');

    // Third argument is `RequestConfig`; a login endpoint has no session to
    // authenticate with yet, so there must not be one.
    expect(mockedRequest.mock.calls[0][2]).toBeUndefined();
  });
});

describe('startWhatsAppOtp', () => {
  it('posts `phone` (not `phoneNumber`) to the canonical route', async () => {
    mockedRequest.mockResolvedValueOnce(buildChallengePayload());

    await startWhatsAppOtp('+6281234567890');

    expect(mockedRequest).toHaveBeenCalledWith('auth/whatsapp/otp/request', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phone: '+6281234567890' }),
    });
  });

  it('resolves with the two timing fields and no challenge id', async () => {
    // There is no `challengeId` in the canonical contract and there will not
    // be one: the phone number is the handle, and at most one challenge is
    // live per number.
    mockedRequest.mockResolvedValueOnce(buildChallengePayload());

    const result: OtpChallenge = await startWhatsAppOtp('+6281234567890');

    expect(Object.keys(result).sort()).toEqual(['expiresInSeconds', 'resendAvailableInSeconds']);
    expect(result).toEqual({ expiresInSeconds: 300, resendAvailableInSeconds: 60 });
  });

  it('returns nothing that reveals whether the number has an account', async () => {
    // ANTI-ENUMERATION: the resolved value is two fixed timing constants. If
    // a field like `accountExists`/`isRegistered` ever appears in this type,
    // the UI could leak who has an account without ever possessing the code.
    mockedRequest.mockResolvedValueOnce(
      buildChallengePayload({ accountExists: true } as Record<string, unknown>)
    );

    const result = await startWhatsAppOtp('+6281234567890');

    expect(Object.keys(result).sort()).toEqual(['expiresInSeconds', 'resendAvailableInSeconds']);
  });
});

describe('startWhatsAppOtp payload validation', () => {
  it('rejects a challenge that is missing the resend countdown', async () => {
    // Regression: this field feeds arithmetic in the resend countdown, so
    // an unchecked cast turned a missing field into NaN - a countdown that
    // never finished and a resend button disabled for the whole session.
    mockedRequest.mockResolvedValueOnce({ success: true, expiresInSeconds: 300 });

    await expect(startWhatsAppOtp('+6281234567890')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a challenge with a non-numeric countdown', async () => {
    mockedRequest.mockResolvedValueOnce(buildChallengePayload({ resendAvailableInSeconds: 'soon' }));

    await expect(startWhatsAppOtp('+6281234567890')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a payload that does not report success', async () => {
    mockedRequest.mockResolvedValueOnce(buildChallengePayload({ success: false }));

    await expect(startWhatsAppOtp('+6281234567890')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a non-object payload', async () => {
    mockedRequest.mockResolvedValueOnce(null);

    await expect(startWhatsAppOtp('+6281234567890')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('verifyWhatsAppOtp', () => {
  it('posts the phone number with the code and resolves with a session', async () => {
    const authResponse = buildAuthResponse();
    mockedRequest.mockResolvedValueOnce(authResponse);

    const result = await verifyWhatsAppOtp('+6281234567890', '123456');

    expect(result).toEqual(authResponse);
    expect(mockedRequest).toHaveBeenCalledWith('auth/whatsapp/otp/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phone: '+6281234567890', code: '123456' }),
    });
  });

  it('is the SIGN-IN route, never the link route', async () => {
    // The two consume the same challenge, so crossing them is a silent
    // behaviour swap: verify replaces the current session, link extends it.
    mockedRequest.mockResolvedValueOnce(buildAuthResponse());

    await verifyWhatsAppOtp('+6281234567890', '123456');

    expect(mockedRequest.mock.calls[0][0]).toBe('auth/whatsapp/otp/verify');
    expect(mockedRequest.mock.calls[0][2]).toBeUndefined();
  });
});

describe('listAuthIdentities', () => {
  it('reads the canonical identities route with auth attached', async () => {
    const identities = [buildIdentity()];
    mockedRequest.mockResolvedValueOnce(identities);

    const result = await listAuthIdentities();

    expect(result).toEqual(identities);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/identities',
      { method: 'GET' },
      { requiresAuth: true }
    );
  });

  it('parses the full canonical identity shape, including a null identifier', async () => {
    mockedRequest.mockResolvedValueOnce([
      buildIdentity({
        provider: 'google',
        identifier: null,
        canBeUnlinked: true,
        verifiedAt: '2026-08-02T00:00:00.000Z',
      }),
    ]);

    const [identity] = await listAuthIdentities();

    expect(identity).toEqual({
      provider: 'google',
      identifier: null,
      usable: true,
      canBeUnlinked: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      verifiedAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('keeps an unfamiliar provider rather than discarding the whole list', async () => {
    // A future provider is a row THIS client cannot render, which
    // `linked-methods.ts` drops. Rejecting the payload here would take out
    // the identities the client can render along with it.
    mockedRequest.mockResolvedValueOnce([
      buildIdentity(),
      buildIdentity({ provider: 'apple' as AuthIdentitySummary['provider'] }),
    ]);

    await expect(listAuthIdentities()).resolves.toHaveLength(2);
  });

  it('rejects an identity missing the authoritative canBeUnlinked flag', async () => {
    // That flag decides whether a destructive control is offered. Arriving
    // as `undefined` would read as "not unlinkable" - the safe direction,
    // but it would hide the contract mismatch entirely.
    const { canBeUnlinked: _omitted, ...withoutFlag } = buildIdentity();
    mockedRequest.mockResolvedValueOnce([withoutFlag]);

    await expect(listAuthIdentities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a payload that is not an array', async () => {
    mockedRequest.mockResolvedValueOnce({ identities: [] });

    await expect(listAuthIdentities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('linkGoogleIdentity', () => {
  it('posts the ID token to the LINK route with auth and returns the updated list', async () => {
    const identities = [buildIdentity(), buildIdentity({ provider: 'google', canBeUnlinked: true })];
    mockedRequest.mockResolvedValueOnce(identities);

    const result = await linkGoogleIdentity('google-id-token');

    expect(result).toEqual(identities);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/identities/google/link',
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ idToken: 'google-id-token' }),
      },
      { requiresAuth: true }
    );
  });

  it('requires the existing session: linking is not a second sign-in', async () => {
    mockedRequest.mockResolvedValueOnce([buildIdentity()]);

    await linkGoogleIdentity('google-id-token');

    expect(mockedRequest.mock.calls[0][0]).not.toBe('auth/google');
    expect(mockedRequest.mock.calls[0][2]).toEqual({ requiresAuth: true });
  });

  it('propagates AUTH_IDENTITY_ALREADY_LINKED instead of swallowing it', async () => {
    const conflict = Object.assign(new Error('Owned elsewhere.'), {
      code: 'AUTH_IDENTITY_ALREADY_LINKED',
    });
    mockedRequest.mockRejectedValueOnce(conflict);

    await expect(linkGoogleIdentity('google-id-token')).rejects.toMatchObject({
      code: 'AUTH_IDENTITY_ALREADY_LINKED',
    });
  });
});

describe('linkWhatsAppIdentity', () => {
  it('posts phone and code to the LINK route with auth and returns the updated list', async () => {
    const identities = [buildIdentity(), buildIdentity({ provider: 'whatsapp', canBeUnlinked: true })];
    mockedRequest.mockResolvedValueOnce(identities);

    const result = await linkWhatsAppIdentity('+6281234567890', '123456');

    expect(result).toEqual(identities);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/identities/whatsapp/link',
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ phone: '+6281234567890', code: '123456' }),
      },
      { requiresAuth: true }
    );
  });

  it('never calls the sign-in verify route, which would replace the session', async () => {
    mockedRequest.mockResolvedValueOnce([buildIdentity()]);

    await linkWhatsAppIdentity('+6281234567890', '123456');

    expect(mockedRequest.mock.calls[0][0]).not.toBe('auth/whatsapp/otp/verify');
  });
});

describe('unlinkAuthIdentity', () => {
  it('deletes the named provider with auth attached and adopts the returned list', async () => {
    // The canonical response is 200 + the caller's full updated identity
    // list, not 204: after removing a method the UI must immediately know
    // what remains and what is still removable.
    const remaining = [buildIdentity()];
    mockedRequest.mockResolvedValueOnce(remaining);

    const result = await unlinkAuthIdentity('google');

    expect(result).toEqual(remaining);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/identities/google',
      { method: 'DELETE' },
      { requiresAuth: true }
    );
  });

  it('propagates AUTH_LAST_IDENTITY rather than reporting a removal', async () => {
    const refusal = Object.assign(new Error('Refused.'), { code: 'AUTH_LAST_IDENTITY' });
    mockedRequest.mockRejectedValueOnce(refusal);

    await expect(unlinkAuthIdentity('google')).rejects.toMatchObject({
      code: 'AUTH_LAST_IDENTITY',
    });
  });
});

describe('provider-auth error propagation', () => {
  it('never swallows a failure into a fake success', async () => {
    const failure = new Error('network down');
    mockedRequest.mockRejectedValueOnce(failure);

    await expect(loginWithGoogleIdToken('google-id-token')).rejects.toThrow('network down');
  });
});
