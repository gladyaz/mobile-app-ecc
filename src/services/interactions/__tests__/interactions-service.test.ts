import { ApiError, request } from '@/services/api/client';
import {
  getInteractions,
  likeVideo,
  saveVideo,
  unlikeVideo,
  unsaveVideo,
} from '@/services/interactions/interactions-service';
import type { LikeResponse, SaveResponse, UserInteraction } from '@/types/interaction';

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

describe('likeVideo', () => {
  it('resolves with the like response on success', async () => {
    const likeResponse: LikeResponse = { videoId: 'video_1', isLiked: true, likeCount: 42 };
    mockedRequest.mockResolvedValueOnce(likeResponse);

    const result = await likeVideo('video_1');

    expect(result).toEqual(likeResponse);
    expect(mockedRequest).toHaveBeenCalledWith(
      'videos/video_1/like',
      expect.objectContaining({ method: 'POST' }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with VIDEO_NOT_FOUND for a nonexistent videoId', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError(404, 'VIDEO_NOT_FOUND', 'Video not found.'));

    await expect(likeVideo('unknown_video')).rejects.toMatchObject({
      status: 404,
      code: 'VIDEO_NOT_FOUND',
    });
  });

  it('propagates INVALID_ACCESS_TOKEN when unauthenticated', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(likeVideo('video_1')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});

describe('unlikeVideo', () => {
  it('resolves with the like response on success', async () => {
    const likeResponse: LikeResponse = { videoId: 'video_1', isLiked: false, likeCount: 41 };
    mockedRequest.mockResolvedValueOnce(likeResponse);

    const result = await unlikeVideo('video_1');

    expect(result).toEqual(likeResponse);
    expect(mockedRequest).toHaveBeenCalledWith(
      'videos/video_1/like',
      expect.objectContaining({ method: 'DELETE' }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with VIDEO_NOT_FOUND for a nonexistent videoId', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError(404, 'VIDEO_NOT_FOUND', 'Video not found.'));

    await expect(unlikeVideo('unknown_video')).rejects.toMatchObject({
      status: 404,
      code: 'VIDEO_NOT_FOUND',
    });
  });

  it('propagates INVALID_ACCESS_TOKEN when unauthenticated', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(unlikeVideo('video_1')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});

describe('saveVideo', () => {
  it('resolves with the save response on success', async () => {
    const saveResponse: SaveResponse = { videoId: 'video_1', isSaved: true };
    mockedRequest.mockResolvedValueOnce(saveResponse);

    const result = await saveVideo('video_1');

    expect(result).toEqual(saveResponse);
    expect(mockedRequest).toHaveBeenCalledWith(
      'videos/video_1/save',
      expect.objectContaining({ method: 'POST' }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with VIDEO_NOT_FOUND for a nonexistent videoId', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError(404, 'VIDEO_NOT_FOUND', 'Video not found.'));

    await expect(saveVideo('unknown_video')).rejects.toMatchObject({
      status: 404,
      code: 'VIDEO_NOT_FOUND',
    });
  });

  it('propagates INVALID_ACCESS_TOKEN when unauthenticated', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(saveVideo('video_1')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});

describe('unsaveVideo', () => {
  it('resolves with the save response on success', async () => {
    const saveResponse: SaveResponse = { videoId: 'video_1', isSaved: false };
    mockedRequest.mockResolvedValueOnce(saveResponse);

    const result = await unsaveVideo('video_1');

    expect(result).toEqual(saveResponse);
    expect(mockedRequest).toHaveBeenCalledWith(
      'videos/video_1/save',
      expect.objectContaining({ method: 'DELETE' }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with VIDEO_NOT_FOUND for a nonexistent videoId', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError(404, 'VIDEO_NOT_FOUND', 'Video not found.'));

    await expect(unsaveVideo('unknown_video')).rejects.toMatchObject({
      status: 404,
      code: 'VIDEO_NOT_FOUND',
    });
  });

  it('propagates INVALID_ACCESS_TOKEN when unauthenticated', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(unsaveVideo('video_1')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});

describe('getInteractions', () => {
  it('resolves with the flat list of interactions on success', async () => {
    const interactions: UserInteraction[] = [
      { videoId: 'video_1', isLiked: true, isSaved: false },
      { videoId: 'video_2', isLiked: false, isSaved: true },
    ];
    mockedRequest.mockResolvedValueOnce(interactions);

    const result = await getInteractions();

    expect(result).toEqual(interactions);
    expect(mockedRequest).toHaveBeenCalledWith(
      'users/me/interactions',
      expect.objectContaining({ method: 'GET' }),
      { requiresAuth: true }
    );
  });

  it('propagates INVALID_ACCESS_TOKEN when unauthenticated', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(getInteractions()).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});
