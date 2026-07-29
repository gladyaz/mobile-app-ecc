import { ApiError, request } from '@/services/api/client';
import { deleteMyAccount } from '@/services/auth/account-deletion-service';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return {
    ...actual,
    request: jest.fn(),
  };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

describe('deleteMyAccount', () => {
  it('sends the current password and the LITERAL boolean true for confirmDeletion', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    await deleteMyAccount('current-password');

    expect(mockedRequest).toHaveBeenCalledWith(
      'users/me/deletion',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'current-password', confirmDeletion: true }),
      }),
      { requiresAuth: true }
    );
  });

  it('resolves with undefined on success', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    await expect(deleteMyAccount('current-password')).resolves.toBeUndefined();
  });

  it('throws ApiError with INVALID_CREDENTIALS (401) for a wrong current password', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    await expect(deleteMyAccount('wrong-password')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('throws ApiError with ACCOUNT_DELETION_FORBIDDEN (403) for a privileged (non-"user") account', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(
        403,
        'ACCOUNT_DELETION_FORBIDDEN',
        'Self-service account deletion is not available for this account type'
      )
    );

    await expect(deleteMyAccount('current-password')).rejects.toMatchObject({
      status: 403,
      code: 'ACCOUNT_DELETION_FORBIDDEN',
    });
  });

  it('throws ApiError with status 429 (generic HTTP_ERROR code) once rate-limited', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(429, 'HTTP_ERROR', 'ThrottlerException: Too Many Requests')
    );

    await expect(deleteMyAccount('current-password')).rejects.toMatchObject({
      status: 429,
    });
  });
});
