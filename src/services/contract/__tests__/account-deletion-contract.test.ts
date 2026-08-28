/**
 * V1 ACCOUNT-DELETION CONTRACT LOCK.
 *
 * WHY THIS SUITE EXISTS SEPARATELY from the rest of the contract layer: the
 * provider-aware deletion surface and the contract lock were built on sibling
 * branches off the same commit, so neither could see the other. The manifest
 * arrived describing every V1 backend surface EXCEPT this one. This closes
 * that omission at the same level of proof the other surfaces already get.
 *
 * WHAT IT PINS, and why these properties and not a full re-test of the
 * service. `account-deletion-service.test.ts` already covers routing, bodies
 * and error mapping. What no suite covered is the CONTRACT property that
 * actually protects the viewer: every V1 sign-in method must keep a usable
 * deletion proof. Google Login and WhatsApp Login mint accounts with NO
 * password, so a regression to a password-only confirmation creates accounts
 * the app cannot delete - and the password path keeps working throughout, so
 * nothing else fails.
 */
import { ApiError, request } from '@/services/api/client';
import {
  DELETION_PROOF_METHODS,
  deleteMyAccount,
  fetchDeletionMethods,
  requestWhatsAppDeletionOtp,
} from '@/services/auth/account-deletion-service';
import {
  V1_ACCOUNT_DELETION_ENDPOINTS,
  V1_DELETION_PROOF_METHODS,
} from '@/services/contract/v1-contract-manifest';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return { ...actual, request: jest.fn() };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('V1 deletion proof contract', () => {
  it('keeps a deletion proof for every V1 sign-in method', () => {
    // Password, Google and WhatsApp. Dropping one here is the regression that
    // creates undeletable accounts, so the manifest and the implementation
    // are pinned to each other rather than each to a literal.
    expect([...DELETION_PROOF_METHODS]).toEqual(V1_DELETION_PROOF_METHODS);
    expect(V1_DELETION_PROOF_METHODS).toEqual(['password', 'google', 'whatsapp']);
  });

  it('declares every deletion endpoint exactly once, with a named owning module', () => {
    const paths = V1_ACCOUNT_DELETION_ENDPOINTS.map((e) => `${e.method} ${e.path}`);

    expect(new Set(paths).size).toBe(paths.length);
    expect(
      V1_ACCOUNT_DELETION_ENDPOINTS.every(
        (e) => e.consumer.includes('.ts#') && e.requiredResponseFields.length > 0
      )
    ).toBe(true);
  });

  it('requires auth on every deletion endpoint', () => {
    // A deletion route reachable without a session would be an account-takeover
    // primitive, not a data-rights feature.
    expect(V1_ACCOUNT_DELETION_ENDPOINTS.every((e) => e.requiresAuth)).toBe(true);
  });

  it('keeps the deletion OTP in its own namespace, distinct from the login OTP', () => {
    const otp = V1_ACCOUNT_DELETION_ENDPOINTS.find((e) => e.path.includes('whatsapp/otp'));

    // The login challenge is `auth/whatsapp/otp/request`. Same SHAPE, different
    // route and different claim namespace - a code issued for one must never
    // satisfy the other.
    expect(otp?.path).toBe('users/me/deletion/whatsapp/otp');
    expect(otp?.path.startsWith('auth/')).toBe(false);
  });
});

describe('deletion methods wire contract', () => {
  it('accepts the canonical payload and returns it in contract order', async () => {
    // Deliberately out of order: callers render the first entry as the default,
    // so arrival order must not decide which proof is offered first.
    mockedRequest.mockResolvedValue({ methods: ['whatsapp', 'password', 'google'] });

    await expect(fetchDeletionMethods()).resolves.toEqual(['password', 'google', 'whatsapp']);
  });

  it('drops an unrecognized future method instead of refusing the whole list', async () => {
    mockedRequest.mockResolvedValue({ methods: ['google', 'apple'] });

    await expect(fetchDeletionMethods()).resolves.toEqual(['google']);
  });

  it('refuses a payload with no methods array', async () => {
    mockedRequest.mockResolvedValue({});

    await expect(fetchDeletionMethods()).rejects.toBeInstanceOf(ApiError);
    await expect(fetchDeletionMethods()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('deletion OTP wire contract', () => {
  it('parses the deletion challenge with the SHARED OTP parser', async () => {
    mockedRequest.mockResolvedValue({
      success: true,
      expiresInSeconds: 300,
      resendAvailableInSeconds: 60,
    });

    await expect(requestWhatsAppDeletionOtp()).resolves.toEqual({
      expiresInSeconds: 300,
      resendAvailableInSeconds: 60,
    });
  });

  it('refuses a challenge missing the resend timing the countdown does arithmetic on', async () => {
    mockedRequest.mockResolvedValue({ success: true, expiresInSeconds: 300 });

    await expect(requestWhatsAppDeletionOtp()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('deletion request contract', () => {
  it('sends each proof on the one endpoint, discriminated by method', async () => {
    mockedRequest.mockResolvedValue({ success: true });

    await deleteMyAccount({ method: 'google', idToken: 'google-id-token' });

    const [path, init, config] = mockedRequest.mock.calls[0];

    expect(path).toBe('users/me/deletion');
    expect(config).toEqual({ requiresAuth: true });
    expect(JSON.parse(String(init?.body))).toEqual({
      method: 'google',
      idToken: 'google-id-token',
      // Always sent, on every method: the backend requires an explicit
      // confirmation flag alongside the proof, so a body that merely carries
      // a valid credential cannot delete an account on its own.
      confirmDeletion: true,
    });
  });

  it('sends the password proof with no method field, for older deployments', async () => {
    mockedRequest.mockResolvedValue({ success: true });

    await deleteMyAccount({ method: 'password', currentPassword: 'pw' });

    const [, init] = mockedRequest.mock.calls[0];

    // The backend defaults `method` to `password`, so apart from the
    // confirmation flag this body is byte-for-byte what every existing client
    // already sends. No `method` key.
    expect(JSON.parse(String(init?.body))).toEqual({
      currentPassword: 'pw',
      confirmDeletion: true,
    });
  });

  it('never carries a proof the chosen method did not ask for', async () => {
    mockedRequest.mockResolvedValue({ success: true });

    await deleteMyAccount({ method: 'whatsapp', code: '123456' });

    const [, init] = mockedRequest.mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toEqual({ method: 'whatsapp', code: '123456', confirmDeletion: true });
    expect(body).not.toHaveProperty('currentPassword');
    expect(body).not.toHaveProperty('idToken');
  });
});
