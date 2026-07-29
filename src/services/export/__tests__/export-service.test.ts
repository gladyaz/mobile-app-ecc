import { ApiError, request } from '@/services/api/client';
import { exportMyData } from '@/services/export/export-service';
import type { UserExport } from '@/types/export';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return {
    ...actual,
    request: jest.fn(),
  };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

function buildExport(overrides?: Partial<UserExport>): UserExport {
  return {
    exportedAt: '2026-07-29T10:00:00.000Z',
    profile: {
      email: 'jane@example.com',
      displayName: 'Jane',
      memberSince: '2026-01-01T00:00:00.000Z',
    },
    interactions: [
      {
        videoId: 'video-1',
        videoTitle: 'Episode 1',
        isLiked: true,
        isSaved: false,
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    watchProgress: [
      {
        seriesId: 'series-1',
        videoId: 'video-1',
        videoTitle: 'Episode 1',
        episodeNumber: 1,
        positionSeconds: 42,
        durationSeconds: 120,
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
    ],
    entitlements: [
      {
        tier: 'premium',
        source: 'dev_grant',
        grantedAt: '2026-01-05T00:00:00.000Z',
        expiresAt: null,
        revokedAt: null,
      },
    ],
    ...overrides,
  };
}

describe('exportMyData', () => {
  it('requests GET users/me/export with auth attached and resolves with the full export', async () => {
    const exportData = buildExport();
    mockedRequest.mockResolvedValueOnce(exportData);

    const result = await exportMyData();

    expect(result).toEqual(exportData);
    expect(mockedRequest).toHaveBeenCalledWith(
      'users/me/export',
      expect.objectContaining({ method: 'GET' }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with status 429 (generic HTTP_ERROR code) once the export rate limit is exceeded', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(429, 'HTTP_ERROR', 'ThrottlerException: Too Many Requests')
    );

    await expect(exportMyData()).rejects.toMatchObject({ status: 429 });
  });

  it('propagates a network failure to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    await expect(exportMyData()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
