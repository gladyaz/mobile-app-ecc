import { ApiError, request } from '@/services/api/client';
import { getProgress, upsertProgress } from '@/services/progress/progress-service';
import type { UserSeriesProgress } from '@/types/progress';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return {
    ...actual,
    request: jest.fn(),
  };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

afterEach(() => {
  mockedRequest.mockReset();
});

describe('upsertProgress', () => {
  it('resolves with the upserted progress on success', async () => {
    const progress: UserSeriesProgress = {
      seriesId: 'series_1',
      videoId: 'video_3',
      episodeNumber: 3,
      positionSeconds: 45,
      durationSeconds: 120,
    };
    mockedRequest.mockResolvedValueOnce(progress);

    const result = await upsertProgress('series_1', 'video_3', 3, 45, 120);

    expect(result).toEqual(progress);
    expect(mockedRequest).toHaveBeenCalledWith(
      'series/series_1/progress',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          videoId: 'video_3',
          episodeNumber: 3,
          positionSeconds: 45,
          durationSeconds: 120,
        }),
      }),
      { requiresAuth: true }
    );
  });

  it('omits durationSeconds from the body when not provided', async () => {
    const progress: UserSeriesProgress = {
      seriesId: 'series_1',
      videoId: 'video_1',
      episodeNumber: 1,
      positionSeconds: 10,
    };
    mockedRequest.mockResolvedValueOnce(progress);

    await upsertProgress('series_1', 'video_1', 1, 10);

    expect(mockedRequest).toHaveBeenCalledWith(
      'series/series_1/progress',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          videoId: 'video_1',
          episodeNumber: 1,
          positionSeconds: 10,
        }),
      }),
      { requiresAuth: true }
    );
  });

  it('rounds fractional positionSeconds/durationSeconds to integers in the request body', async () => {
    const progress: UserSeriesProgress = {
      seriesId: 'series_1',
      videoId: 'video-104-01',
      episodeNumber: 1,
      positionSeconds: 39,
      durationSeconds: 123,
    };
    mockedRequest.mockResolvedValueOnce(progress);

    await upsertProgress('series_1', 'video-104-01', 1, 38.719252, 123.345011);

    expect(mockedRequest).toHaveBeenCalledWith(
      'series/series_1/progress',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          videoId: 'video-104-01',
          episodeNumber: 1,
          positionSeconds: 39,
          durationSeconds: 123,
        }),
      }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with VIDEO_NOT_FOUND for a nonexistent videoId', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError(404, 'VIDEO_NOT_FOUND', 'Video not found.'));

    await expect(upsertProgress('series_1', 'unknown_video', 1, 0)).rejects.toMatchObject({
      status: 404,
      code: 'VIDEO_NOT_FOUND',
    });
  });

  it('propagates INVALID_ACCESS_TOKEN when unauthenticated', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(upsertProgress('series_1', 'video_1', 1, 0)).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});

describe('getProgress', () => {
  it('resolves with the flat list of series progress on success', async () => {
    const progressList: UserSeriesProgress[] = [
      {
        seriesId: 'series_1',
        videoId: 'video_2',
        episodeNumber: 2,
        positionSeconds: 30,
      },
    ];
    mockedRequest.mockResolvedValueOnce(progressList);

    const result = await getProgress();

    expect(result).toEqual(progressList);
    expect(mockedRequest).toHaveBeenCalledWith(
      'users/me/progress',
      expect.objectContaining({ method: 'GET' }),
      { requiresAuth: true }
    );
  });

  it('propagates INVALID_ACCESS_TOKEN when unauthenticated', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(getProgress()).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});
