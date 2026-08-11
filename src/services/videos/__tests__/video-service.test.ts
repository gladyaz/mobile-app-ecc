import { ApiError, request } from '@/services/api/client';
import { isDemoMode } from '@/services/demo/demo-mode';
import { getPlaybackAuthorization, resolvePlaybackSource } from '@/services/videos/video-service';
import type {
  HlsPlaybackAuthorization,
  Mp4PlaybackAuthorization,
  PlaybackRendition,
} from '@/types/playback';
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
    it('calls GET /videos/:id/playback with requiresAuth and normalizes a legacy response to kind: "mp4"', async () => {
      const authorization = {
        playbackUrl: 'https://media.example.com/videos/video-1/stream',
        expiresAt: '2026-08-08T10:15:00.000Z',
        requiresAuthHeader: true,
      };
      mockedRequest.mockResolvedValueOnce(authorization);

      const result = await getPlaybackAuthorization('video-1');

      expect(result).toEqual({ kind: 'mp4', ...authorization });
      expect(mockedRequest).toHaveBeenCalledWith(
        'videos/video-1/playback',
        expect.objectContaining({ method: 'GET' }),
        { requiresAuth: true }
      );
    });

    it('resolves a presigned R2 response with requiresAuthHeader: false unchanged, normalized to kind: "mp4"', async () => {
      const authorization = {
        playbackUrl: 'https://r2.example.com/bucket/video-2.mp4?X-Amz-Signature=abc',
        expiresAt: '2026-08-08T10:15:00.000Z',
        requiresAuthHeader: false,
      };
      mockedRequest.mockResolvedValueOnce(authorization);

      const result = await getPlaybackAuthorization('video-2');

      expect(result).toEqual({ kind: 'mp4', ...authorization });
    });

    it('normalizes a type: "hls" response to kind: "hls", echoing masterUrl/renditions/expiresAt verbatim (Slice 11R)', async () => {
      const hlsResponse = {
        type: 'hls' as const,
        masterUrl: 'https://gateway.example.com/videos/video-3/master.m3u8?token=xyz',
        renditions: [
          {
            quality: '720p',
            width: 1280,
            height: 720,
            url: 'https://gateway.example.com/videos/video-3/720p.m3u8',
          },
        ],
        expiresAt: '2026-08-11T10:15:00.000Z',
      };
      mockedRequest.mockResolvedValueOnce(hlsResponse);

      const result = await getPlaybackAuthorization('video-3');

      expect(result).toEqual({
        kind: 'hls',
        masterUrl: hlsResponse.masterUrl,
        renditions: hlsResponse.renditions,
        expiresAt: hlsResponse.expiresAt,
      });
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

    it('resolves the matching mock video\'s own playbackUrl as kind: "mp4" with requiresAuthHeader true outside demo mode', async () => {
      mockedIsDemoMode.mockReturnValue(false);

      const result = await getPlaybackAuthorization('mock-video-1');

      expect(result.kind).toBe('mp4');
      if (result.kind !== 'mp4') {
        throw new Error('expected a kind: "mp4" result');
      }

      expect(result.playbackUrl).toBe('asset://mock-video-1.mp4');
      expect(result.requiresAuthHeader).toBe(true);
      // 15 minutes out, matching the real backend's expiry window.
      expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('resolves with requiresAuthHeader false in a demo build (a bundled clip has nothing to authorize)', async () => {
      mockedIsDemoMode.mockReturnValue(true);

      const result = await getPlaybackAuthorization('mock-video-2');

      if (result.kind !== 'mp4') {
        throw new Error('expected a kind: "mp4" result');
      }

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

      await expect(getPlaybackAuthorization('video-1')).resolves.toEqual({
        kind: 'mp4',
        ...authorization,
      });
    });
  });

  // Slice 11R: the HLS half of the same shape-validation contract.
  describe('HLS response-shape validation (Slice 11R)', () => {
    const validRendition = {
      quality: '720p',
      width: 1280,
      height: 720,
      url: 'https://gateway.example.com/videos/video-1/720p.m3u8',
    };

    it.each([
      [
        'an empty masterUrl',
        {
          type: 'hls',
          masterUrl: '',
          expiresAt: '2026-08-08T10:15:00.000Z',
          renditions: [validRendition],
        },
      ],
      [
        'a missing masterUrl',
        { type: 'hls', expiresAt: '2026-08-08T10:15:00.000Z', renditions: [validRendition] },
      ],
      [
        'an unparseable expiresAt',
        {
          type: 'hls',
          masterUrl: 'https://gateway.example.com/videos/video-1/master.m3u8',
          expiresAt: 'not-a-date',
          renditions: [validRendition],
        },
      ],
      [
        'a non-array renditions',
        {
          type: 'hls',
          masterUrl: 'https://gateway.example.com/videos/video-1/master.m3u8',
          expiresAt: '2026-08-08T10:15:00.000Z',
          renditions: 'not-an-array',
        },
      ],
      [
        'a rendition missing a url',
        {
          type: 'hls',
          masterUrl: 'https://gateway.example.com/videos/video-1/master.m3u8',
          expiresAt: '2026-08-08T10:15:00.000Z',
          renditions: [{ quality: '720p', width: 1280, height: 720 }],
        },
      ],
    ])('throws, rather than resolving, for a type: "hls" response with %s', async (_label, malformed) => {
      mockedRequest.mockResolvedValueOnce(malformed);

      await expect(getPlaybackAuthorization('video-1')).rejects.toThrow();
    });

    it('never includes the masterUrl (which carries a gateway token) in the thrown error message', async () => {
      mockedRequest.mockResolvedValueOnce({
        type: 'hls',
        masterUrl: 'https://gateway.example.com/videos/video-1/master.m3u8?token=super-secret',
        expiresAt: 'not-a-date',
        renditions: [validRendition],
      });

      await expect(getPlaybackAuthorization('video-1')).rejects.not.toThrow(
        expect.stringContaining('super-secret')
      );
    });

    it('rejects a type: "hls" response missing masterUrl/renditions even when it also carries a full legacy triple (backend partial-rollout state), instead of silently falling through to kind: "mp4"', async () => {
      mockedRequest.mockResolvedValueOnce({
        type: 'hls',
        playbackUrl: 'https://media.example.com/videos/video-1/stream',
        requiresAuthHeader: true,
        expiresAt: '2026-08-08T10:15:00.000Z',
      });

      await expect(getPlaybackAuthorization('video-1')).rejects.toThrow();
    });
  });
});

// Slice 11R: `resolvePlaybackSource` is the ONE testable decision point
// between a resolved playback authorization and an `expo-video` source -
// exercised directly here rather than only indirectly through a component.
describe('resolvePlaybackSource', () => {
  function buildHls(overrides: Partial<HlsPlaybackAuthorization> = {}): HlsPlaybackAuthorization {
    return {
      kind: 'hls',
      masterUrl: 'https://gateway.example.com/videos/video-1/master.m3u8?token=abc',
      expiresAt: '2026-08-11T10:15:00.000Z',
      renditions: [
        {
          quality: '720p',
          width: 1280,
          height: 720,
          url: 'https://gateway.example.com/videos/video-1/720p.m3u8',
        } satisfies PlaybackRendition,
      ],
      ...overrides,
    };
  }

  function buildMp4(overrides: Partial<Mp4PlaybackAuthorization> = {}): Mp4PlaybackAuthorization {
    return {
      kind: 'mp4',
      playbackUrl: 'https://media.example.com/videos/video-1/stream',
      requiresAuthHeader: true,
      expiresAt: '2026-08-11T10:15:00.000Z',
      ...overrides,
    };
  }

  it('kind: "hls" + HLS enabled: uses the backend-provided masterUrl verbatim, with no headers', () => {
    const auth = buildHls();

    expect(resolvePlaybackSource(auth, 'token-123', true)).toEqual({ uri: auth.masterUrl });
  });

  it('kind: "mp4" with requiresAuthHeader true: attaches Authorization: Bearer <accessToken> (byte-identical to pre-11R)', () => {
    const auth = buildMp4({ requiresAuthHeader: true });

    expect(resolvePlaybackSource(auth, 'token-123', true)).toEqual({
      uri: auth.playbackUrl,
      headers: { Authorization: 'Bearer token-123' },
    });
  });

  it('kind: "mp4" with requiresAuthHeader false: no headers, exactly as the presigned-R2 path has always behaved', () => {
    const auth = buildMp4({ requiresAuthHeader: false });

    expect(resolvePlaybackSource(auth, 'token-123', true)).toEqual({
      uri: auth.playbackUrl,
      headers: undefined,
    });
  });

  it('kind: "mp4" is unaffected by the HLS-enabled flag either way (the flag only gates the HLS branch)', () => {
    const auth = buildMp4();

    expect(resolvePlaybackSource(auth, 'token-123', true)).toEqual(
      resolvePlaybackSource(auth, 'token-123', false)
    );
  });

  it('kind: "hls" + HLS disabled (kill switch): returns null - HLS-ready media has no client-side MP4 to fall back to', () => {
    const auth = buildHls();

    expect(resolvePlaybackSource(auth, 'token-123', false)).toBeNull();
  });

  it('never reconstructs or guesses a storage/CDN path - the returned uri is reference-equal to the backend-provided masterUrl string', () => {
    const auth = buildHls({ masterUrl: 'https://gateway.example.com/exact/path/master.m3u8?token=xyz' });

    const source = resolvePlaybackSource(auth, 'token-123', true);

    expect(source?.uri).toBe(auth.masterUrl);
  });

  it('the selector\'s own function body never contains a hardcoded workers.dev host or an "admin-media/" path segment (static, grep-style guard)', () => {
    // A regression here would mean a future edit started building/guessing a
    // Worker or R2 object path client-side instead of only ever echoing the
    // backend-provided masterUrl - exactly what Slice 11R's approval
    // explicitly prohibits. `Function.prototype.toString()` returns the
    // selector's actual source text, so this asserts against the real
    // shipped logic rather than a separately-maintained copy of it.
    const selectorSource = resolvePlaybackSource.toString();

    expect(selectorSource).not.toMatch(/workers\.dev/);
    expect(selectorSource).not.toMatch(/admin-media\//);
  });
});
