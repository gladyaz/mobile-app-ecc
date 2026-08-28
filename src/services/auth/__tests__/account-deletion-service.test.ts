import { ApiError, request } from '@/services/api/client';
import {
  deleteMyAccount,
  fetchDeletionMethods,
  requestWhatsAppDeletionOtp,
} from '@/services/auth/account-deletion-service';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return {
    ...actual,
    request: jest.fn(),
  };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

beforeEach(() => {
  jest.clearAllMocks();
});

/** The body the service actually put on the wire, parsed back. */
function sentBody(): unknown {
  const init = mockedRequest.mock.calls[0]?.[1] as { body?: string } | undefined;

  return JSON.parse(init?.body ?? 'null');
}

describe('fetchDeletionMethods', () => {
  it('reads GET /users/me/deletion/methods with auth', async () => {
    mockedRequest.mockResolvedValueOnce({ methods: ['password'] });

    await fetchDeletionMethods();

    expect(mockedRequest).toHaveBeenCalledWith(
      'users/me/deletion/methods',
      { method: 'GET' },
      { requiresAuth: true }
    );
  });

  it('returns the full set for a multi-method account', async () => {
    mockedRequest.mockResolvedValueOnce({ methods: ['password', 'google', 'whatsapp'] });

    await expect(fetchDeletionMethods()).resolves.toEqual(['password', 'google', 'whatsapp']);
  });

  it('returns just "google" for a Google-only account', async () => {
    mockedRequest.mockResolvedValueOnce({ methods: ['google'] });

    await expect(fetchDeletionMethods()).resolves.toEqual(['google']);
  });

  it('returns just "whatsapp" for a WhatsApp-only account', async () => {
    mockedRequest.mockResolvedValueOnce({ methods: ['whatsapp'] });

    await expect(fetchDeletionMethods()).resolves.toEqual(['whatsapp']);
  });

  it('treats an EMPTY list as a truthful answer, not an error', async () => {
    // A Google-only account on a server with Google verification disabled
    // genuinely has no usable proof. The backend documents this as a
    // reachable, correct response - the client must surface it, not throw.
    mockedRequest.mockResolvedValueOnce({ methods: [] });

    await expect(fetchDeletionMethods()).resolves.toEqual([]);
  });

  it('re-sorts into the contract order rather than trusting arrival order', async () => {
    // Callers render the first entry as the default; a default that moved
    // because a server changed its row order would be a different screen for
    // the same account.
    mockedRequest.mockResolvedValueOnce({ methods: ['whatsapp', 'password'] });

    await expect(fetchDeletionMethods()).resolves.toEqual(['password', 'whatsapp']);
  });

  it('drops an unrecognized method but keeps the ones this build can render', async () => {
    // Forward compatibility: a future fourth provider must not take out the
    // methods this client CAN produce.
    mockedRequest.mockResolvedValueOnce({ methods: ['password', 'apple'] });

    await expect(fetchDeletionMethods()).resolves.toEqual(['password']);
  });

  it('throws a legible INVALID_RESPONSE when `methods` is missing entirely', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    await expect(fetchDeletionMethods()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('requestWhatsAppDeletionOtp', () => {
  it('posts the DELETION otp route - never the login one - with no phone in the body', async () => {
    mockedRequest.mockResolvedValueOnce({
      success: true,
      expiresInSeconds: 300,
      resendAvailableInSeconds: 60,
    });

    await requestWhatsAppDeletionOtp();

    const [path, init, config] = mockedRequest.mock.calls[0];

    expect(path).toBe('users/me/deletion/whatsapp/otp');
    // The login route would issue a code in the session-minting namespace.
    expect(path).not.toBe('auth/whatsapp/otp/request');
    expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(config).toEqual({ requiresAuth: true });
    // No `phone`: the number comes from the caller's own linked identity, so
    // this route can never be pointed at a number the caller merely knows.
    expect((init as { body?: string }).body).toBeUndefined();
  });

  it('returns the timing constants that drive the resend countdown', async () => {
    mockedRequest.mockResolvedValueOnce({
      success: true,
      expiresInSeconds: 300,
      resendAvailableInSeconds: 60,
    });

    await expect(requestWhatsAppDeletionOtp()).resolves.toEqual({
      expiresInSeconds: 300,
      resendAvailableInSeconds: 60,
    });
  });

  it('throws INVALID_RESPONSE rather than producing NaN when resendAvailableInSeconds is absent', async () => {
    // The regression this boundary check exists for: an absent field became
    // NaN, the countdown never finished, and resend stayed disabled forever.
    mockedRequest.mockResolvedValueOnce({ success: true, expiresInSeconds: 300 });

    await expect(requestWhatsAppDeletionOtp()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('propagates a 429 cooldown untouched', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(429, 'OTP_RESEND_COOLDOWN', 'Please wait before requesting another.')
    );

    await expect(requestWhatsAppDeletionOtp()).rejects.toMatchObject({
      status: 429,
      code: 'OTP_RESEND_COOLDOWN',
    });
  });

  it('propagates a 503 provider-unavailable untouched', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(503, 'WHATSAPP_PROVIDER_UNAVAILABLE', 'Could not send the code right now.')
    );

    await expect(requestWhatsAppDeletionOtp()).rejects.toMatchObject({
      status: 503,
      code: 'WHATSAPP_PROVIDER_UNAVAILABLE',
    });
  });
});

describe('deleteMyAccount - password (preserved behaviour)', () => {
  it('sends the pre-existing body verbatim: currentPassword plus the LITERAL boolean true', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    await deleteMyAccount({ method: 'password', currentPassword: 'current-password' });

    expect(mockedRequest).toHaveBeenCalledWith(
      'users/me/deletion',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'current-password', confirmDeletion: true }),
      }),
      { requiresAuth: true }
    );
  });

  it('sends NO `method` field for a password deletion', async () => {
    // The backend defaults `method` to "password" precisely so every existing
    // client keeps working. Sending it would gain nothing and would make this
    // path depend on a DTO older deployments reject outright.
    mockedRequest.mockResolvedValueOnce({ success: true });

    await deleteMyAccount({ method: 'password', currentPassword: 'current-password' });

    expect(sentBody()).not.toHaveProperty('method');
  });

  it('resolves with undefined on success', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    await expect(
      deleteMyAccount({ method: 'password', currentPassword: 'current-password' })
    ).resolves.toBeUndefined();
  });

  it('throws ApiError with INVALID_CREDENTIALS (401) for a wrong current password', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    await expect(
      deleteMyAccount({ method: 'password', currentPassword: 'wrong-password' })
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('throws ApiError with ACCOUNT_DELETION_FORBIDDEN (403) for a privileged (non-"user") account', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(
        403,
        'ACCOUNT_DELETION_FORBIDDEN',
        'Self-service account deletion is not available for this account type'
      )
    );

    await expect(
      deleteMyAccount({ method: 'password', currentPassword: 'current-password' })
    ).rejects.toMatchObject({ status: 403, code: 'ACCOUNT_DELETION_FORBIDDEN' });
  });

  it('throws ApiError with status 429 (generic HTTP_ERROR code) once rate-limited', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(429, 'HTTP_ERROR', 'ThrottlerException: Too Many Requests')
    );

    await expect(
      deleteMyAccount({ method: 'password', currentPassword: 'current-password' })
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('deleteMyAccount - google', () => {
  it('names the method and sends the ID token, and nothing else that could serve as proof', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    await deleteMyAccount({ method: 'google', idToken: 'synthetic.google.id-token' });

    expect(sentBody()).toEqual({
      method: 'google',
      idToken: 'synthetic.google.id-token',
      confirmDeletion: true,
    });
  });

  it('never sends a password alongside a Google proof', async () => {
    // Structurally impossible via the DeletionProof union - asserted anyway,
    // because "no request can downgrade its own proof" is the property.
    mockedRequest.mockResolvedValueOnce({ success: true });

    await deleteMyAccount({ method: 'google', idToken: 'synthetic.google.id-token' });

    expect(sentBody()).not.toHaveProperty('currentPassword');
  });

  it('propagates INVALID_GOOGLE_TOKEN (401) when the credential does not verify', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Invalid Google token')
    );

    await expect(
      deleteMyAccount({ method: 'google', idToken: 'synthetic.google.id-token' })
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_GOOGLE_TOKEN' });
  });

  it('propagates ACCOUNT_DELETION_PROOF_MISMATCH (401) for the WRONG Google account', async () => {
    // Verified credential, wrong identity: the backend compares the token's
    // `sub` against this account's own linked subject.
    mockedRequest.mockRejectedValueOnce(
      new ApiError(
        401,
        'ACCOUNT_DELETION_PROOF_MISMATCH',
        'That Google account is not the one linked to this account.'
      )
    );

    await expect(
      deleteMyAccount({ method: 'google', idToken: 'synthetic.google.id-token' })
    ).rejects.toMatchObject({ status: 401, code: 'ACCOUNT_DELETION_PROOF_MISMATCH' });
  });
});

describe('deleteMyAccount - whatsapp', () => {
  it('names the method and sends only the code - never a phone number', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    await deleteMyAccount({ method: 'whatsapp', code: '123456' });

    expect(sentBody()).toEqual({ method: 'whatsapp', code: '123456', confirmDeletion: true });
    expect(sentBody()).not.toHaveProperty('phone');
  });

  it('propagates INVALID_OTP (401) for a wrong code', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_OTP', 'Invalid or expired verification code')
    );

    await expect(deleteMyAccount({ method: 'whatsapp', code: '000000' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_OTP',
    });
  });

  it('propagates the SAME INVALID_OTP for an expired code and for an exhausted attempt budget', async () => {
    // The backend refuses to distinguish these, and the client must not
    // invent the distinction: one code, several causes, one message.
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_OTP', 'Invalid or expired verification code')
    );
    await expect(deleteMyAccount({ method: 'whatsapp', code: '123456' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_OTP',
    });

    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_OTP', 'Invalid or expired verification code')
    );
    await expect(deleteMyAccount({ method: 'whatsapp', code: '123456' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_OTP',
    });
  });

  it('propagates ACCOUNT_DELETION_METHOD_UNAVAILABLE (409) when the account cannot use this proof', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(
        409,
        'ACCOUNT_DELETION_METHOD_UNAVAILABLE',
        'This account cannot confirm deletion with "whatsapp".'
      )
    );

    await expect(deleteMyAccount({ method: 'whatsapp', code: '123456' })).rejects.toMatchObject({
      status: 409,
      code: 'ACCOUNT_DELETION_METHOD_UNAVAILABLE',
    });
  });
});
