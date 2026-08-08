import { ApiError, request } from '@/services/api/client';
import { isDemoMode } from '@/services/demo/demo-mode';
import { getPlaybackAuthorization } from '@/services/videos/video-service';
import type { Video } from '@/types/video';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return {
    ...actual,
    request: jest.fn(),
  };
});

jest.mock('@/services/demo/demo-mode', () => ({
  isDemoMode: jest.fn(() => false),
}));

// A small controlled fixture in place of the real bundled catalog (which
// resolves real asset files via `expo-asset` - not something this
// service-level unit test needs to exercise for real).
jest.mock('@/data/mock-drama-videos', () => ({
  mockDramaVideos: [
    { id: 'mock-video-1', playbackUrl: 'asset://mock-video-1.mp4' },
    { id: 'mock-video-2', playbackUrl: 'asset://mock-video-2.mp4' },
  ] as readonly Partial<Video>[],
}));

const mockedRequest = request as jest.MockedFunction<typeof request>;
const mockedIsDemoMode = isDemoMode as jest.MockedFunction<typeof isDemoMode>;

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_USE_MOCK_DATA;

afterEach(() => {
  process.env.EXPO_PUBLIC_USE_MOCK_DATA = ORIGINAL_ENV;
  // `clearMocks` (jest config) only clears call history, not a configured
  // `mockReturnValue` - without this, the demo-build test below would leak
  // `isDemoMode() === true` into every test declared after it.
  mockedIsDemoMode.mockReturnValue(false);
});

describe('getPlaybackAuthorization', () => {
  describe('real backend mode', () => {
    it('calls GET /videos/:id/playback with requiresAuth and resolves the response verbatim', async () => {
      const authorization = {
        playbackUrl: 'https://media.example.com/videos/video-1/stream',
        expiresAt: '2026-08-08T10:15:00.000Z',
        requiresAuthHeader: true,
      };
      mockedRequest.mockResolvedValueOnce(authorization);

      const result = await getPlaybackAuthorization('video-1');

      expect(result).toEqual(authorization);
      expect(mockedRequest).toHaveBeenCalledWith(
        'videos/video-1/playback',
        expect.objectContaining({ method: 'GET' }),
        { requiresAuth: true }
      );
    });

    it('resolves a presigned R2 response with requiresAuthHeader: false unchanged', async () => {
      const authorization = {
        playbackUrl: 'https://r2.example.com/bucket/video-2.mp4?X-Amz-Signature=abc',
        expiresAt: '2026-08-08T10:15:00.000Z',
        requiresAuthHeader: false,
      };
      mockedRequest.mockResolvedValueOnce(authorization);

      const result = await getPlaybackAuthorization('video-2');

      expect(result).toEqual(authorization);
    });

    it.each([
      ['not found / not published', 404, 'VIDEO_NOT_FOUND'],
      ['unauthenticated', 401, 'INVALID_ACCESS_TOKEN'],
      ['premium episode, no entitlement', 403, 'ENTITLEMENT_REQUIRED'],
      ['no usable storage', 409, 'MEDIA_PLAYBACK_SOURCE_UNAVAILABLE'],
    ])('propagates ApiError for %s (%d %s) without catching it', async (_label, status, code) => {
      mockedRequest.mockRejectedValueOnce(new ApiError(status, code, 'failed'));

      await expect(getPlaybackAuthorization('video-1')).rejects.toMatchObject({ status, code });
    });
  });

  describe('mock-data mode', () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_USE_MOCK_DATA = 'true';
    });

    it('never calls the network', async () => {
      await getPlaybackAuthorization('mock-video-1');

      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('resolves the matching mock video\'s own playbackUrl with requiresAuthHeader true outside demo mode', async () => {
      mockedIsDemoMode.mockReturnValue(false);

      const result = await getPlaybackAuthorization('mock-video-1');

      expect(result.playbackUrl).toBe('asset://mock-video-1.mp4');
      expect(result.requiresAuthHeader).toBe(true);
      // 15 minutes out, matching the real backend's expiry window.
      expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('resolves with requiresAuthHeader false in a demo build (a bundled clip has nothing to authorize)', async () => {
      mockedIsDemoMode.mockReturnValue(true);

      const result = await getPlaybackAuthorization('mock-video-2');

      expect(result.playbackUrl).toBe('asset://mock-video-2.mp4');
      expect(result.requiresAuthHeader).toBe(false);
    });

    it('throws (never resolves an empty playbackUrl) for an id with no match in the mock catalog', async () => {
      // MEDIUM-5: an empty playbackUrl is a silent, permanent black screen
      // downstream - an unknown id must fail the same "unavailable" way a
      // real backend's 404 would, not resolve a "success" with nothing to
      // play.
      await expect(getPlaybackAuthorization('does-not-exist')).rejects.toThrow();
    });
  });

  describe('response-shape validation (MEDIUM-5)', () => {
    it.each([
      ['an empty playbackUrl', { playbackUrl: '', expiresAt: '2026-08-08T10:15:00.000Z', requiresAuthHeader: true }],
      ['a missing playbackUrl', { expiresAt: '2026-08-08T10:15:00.000Z', requiresAuthHeader: true }],
      ['a non-string expiresAt', { playbackUrl: 'https://media.example.com/x.mp4', expiresAt: 12345, requiresAuthHeader: true }],
      ['an unparseable expiresAt', { playbackUrl: 'https://media.example.com/x.mp4', expiresAt: 'not-a-date', requiresAuthHeader: true }],
      ['a missing requiresAuthHeader', { playbackUrl: 'https://media.example.com/x.mp4', expiresAt: '2026-08-08T10:15:00.000Z' }],
      ['a non-boolean requiresAuthHeader', { playbackUrl: 'https://media.example.com/x.mp4', expiresAt: '2026-08-08T10:15:00.000Z', requiresAuthHeader: 'true' }],
      ['null', null],
      ['a string', 'not an object'],
    ])('throws, rather than resolving, for a 200 response with %s', async (_label, malformed) => {
      mockedRequest.mockResolvedValueOnce(malformed);

      await expect(getPlaybackAuthorization('video-1')).rejects.toThrow();
    });

    it('never includes the response payload (which may carry a signed URL) in the thrown error message', async () => {
      mockedRequest.mockResolvedValueOnce({
        playbackUrl: 'https://r2.example.com/bucket/video-1.mp4?X-Amz-Signature=super-secret',
        expiresAt: 'not-a-date',
        requiresAuthHeader: false,
      });

      await expect(getPlaybackAuthorization('video-1')).rejects.not.toThrow(
        expect.stringContaining('super-secret')
      );
    });

    it('resolves normally for a valid response', async () => {
      const authorization = {
        playbackUrl: 'https://media.example.com/videos/video-1/stream',
        expiresAt: '2026-08-08T10:15:00.000Z',
        requiresAuthHeader: true,
      };
      mockedRequest.mockResolvedValueOnce(authorization);

      await expect(getPlaybackAuthorization('video-1')).resolves.toEqual(authorization);
    });
  });
});
