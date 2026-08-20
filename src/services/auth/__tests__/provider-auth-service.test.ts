import { request } from '@/services/api/client';
import {
  listLinkedAuthMethods,
  loginWithGoogleIdToken,
  startWhatsAppOtp,
  unlinkAuthMethod,
  verifyWhatsAppOtp,
} from '@/services/auth/provider-auth-service';
import type { AuthResponse, LinkedAuthMethod, OtpChallenge } from '@/types/auth';

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

function buildChallenge(): OtpChallenge {
  return { challengeId: 'challenge_1', expiresInSeconds: 300, resendAvailableInSeconds: 60 };
}

describe('loginWithGoogleIdToken', () => {
  it('posts the ID token and resolves with the app own session tokens', async () => {
    const authResponse = buildAuthResponse();
    mockedRequest.mockResolvedValueOnce(authResponse);

    const result = await loginWithGoogleIdToken('google-id-token');

    expect(result).toEqual(authResponse);
    expect(mockedRequest).toHaveBeenCalledWith('auth/providers/google', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ idToken: 'google-id-token' }),
    });
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
  it('sends the normalized E.164 number and resolves with a challenge handle', async () => {
    const challenge = buildChallenge();
    mockedRequest.mockResolvedValueOnce(challenge);

    const result = await startWhatsAppOtp('+6281234567890');

    expect(result).toEqual(challenge);
    expect(mockedRequest).toHaveBeenCalledWith('auth/providers/whatsapp/start', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: '+6281234567890' }),
    });
  });

  it('returns nothing that reveals whether the number has an account', async () => {
    // ANTI-ENUMERATION: the resolved value is a challenge handle plus
    // timings. If a field like `accountExists`/`isRegistered` ever appears
    // in this type, the UI could leak who has an account without ever
    // possessing the code.
    mockedRequest.mockResolvedValueOnce(buildChallenge());

    const result = await startWhatsAppOtp('+6281234567890');

    expect(Object.keys(result).sort()).toEqual([
      'challengeId',
      'expiresInSeconds',
      'resendAvailableInSeconds',
    ]);
  });
});

describe('startWhatsAppOtp payload validation', () => {
  it('rejects a challenge that is missing the resend countdown', async () => {
    // Regression: this field feeds arithmetic in the resend countdown, so
    // an unchecked cast turned a missing field into NaN - a countdown that
    // never finished and a resend button disabled for the whole session.
    mockedRequest.mockResolvedValueOnce({ challengeId: 'challenge_1', expiresInSeconds: 300 });

    await expect(startWhatsAppOtp('+6281234567890')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a challenge with a non-numeric countdown', async () => {
    mockedRequest.mockResolvedValueOnce({
      challengeId: 'challenge_1',
      expiresInSeconds: 300,
      resendAvailableInSeconds: 'soon',
    });

    await expect(startWhatsAppOtp('+6281234567890')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a challenge with no usable challenge id', async () => {
    mockedRequest.mockResolvedValueOnce({
      challengeId: '',
      expiresInSeconds: 300,
      resendAvailableInSeconds: 60,
    });

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
  it('posts the challenge id with the code and resolves with a session', async () => {
    const authResponse = buildAuthResponse();
    mockedRequest.mockResolvedValueOnce(authResponse);

    const result = await verifyWhatsAppOtp('challenge_1', '123456');

    expect(result).toEqual(authResponse);
    expect(mockedRequest).toHaveBeenCalledWith('auth/providers/whatsapp/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ challengeId: 'challenge_1', code: '123456' }),
    });
  });
});

describe('listLinkedAuthMethods', () => {
  it('requires auth and resolves with the raw method list', async () => {
    const methods: readonly LinkedAuthMethod[] = [
      { provider: 'email', label: 'j***@example.com', linkedAt: '2026-08-01T00:00:00.000Z' },
    ];
    mockedRequest.mockResolvedValueOnce(methods);

    const result = await listLinkedAuthMethods();

    expect(result).toEqual(methods);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/methods',
      { method: 'GET' },
      { requiresAuth: true }
    );
  });
});

describe('unlinkAuthMethod', () => {
  it('deletes the named provider with auth attached', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);

    await unlinkAuthMethod('google');

    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/methods/google',
      { method: 'DELETE' },
      { requiresAuth: true }
    );
  });
});

describe('provider-auth error propagation', () => {
  it('never swallows a failure into a fake success', async () => {
    // The backend contract behind these endpoints is not landed yet, so the
    // one thing that must be true today is that nothing here invents a
    // session when the network says no.
    const failure = new Error('network down');
    mockedRequest.mockRejectedValueOnce(failure);

    await expect(loginWithGoogleIdToken('google-id-token')).rejects.toThrow('network down');
  });
});
