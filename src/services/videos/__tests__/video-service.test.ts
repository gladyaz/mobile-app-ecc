import { ApiError, request } from '@/services/api/client';
import { isDemoMode } from '@/services/demo/demo-mode';
import { AUTO_PLAYBACK_QUALITY } from '@/constants/playback-quality';
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

    it('carries a well-formed `fallback` through verbatim (work unit "HLS MP4 FALLBACK")', async () => {
      const fallback = {
        playbackUrl: 'https://r2.example.com/bucket/source.mp4?X-Amz-Signature=abc',
        expiresAt: '2026-08-11T10:00:00.000Z',
        requiresAuthHeader: false,
      };
      mockedRequest.mockResolvedValueOnce({
        type: 'hls' as const,
        masterUrl: 'https://gateway.example.com/videos/video-9/master.m3u8?token=xyz',
        renditions: [],
        expiresAt: '2026-08-11T10:15:00.000Z',
        fallback,
      });

      const result = await getPlaybackAuthorization('video-9');

      expect(result).toMatchObject({ kind: 'hls', fallback });
    });

    it('DROPS a malformed `fallback` but still resolves the HLS response - an optional field must never fail a good response', async () => {
      mockedRequest.mockResolvedValueOnce({
        type: 'hls' as const,
        masterUrl: 'https://gateway.example.com/videos/video-10/master.m3u8?token=xyz',
        renditions: [],
        expiresAt: '2026-08-11T10:15:00.000Z',
        // `requiresAuthHeader` missing, `expiresAt` unparseable.
        fallback: { playbackUrl: 'https://media.example.com/x.mp4', expiresAt: 'not-a-date' },
      });

      const result = await getPlaybackAuthorization('video-10');

      expect(result).toMatchObject({ kind: 'hls' });
      expect((result as { fallback?: unknown }).fallback).toBeUndefined();
    });

    it('omits `fallback` entirely when the backend sent none - the pre-fallback shape still parses', async () => {
      mockedRequest.mockResolvedValueOnce({
        type: 'hls' as const,
        masterUrl: 'https://gateway.example.com/videos/video-11/master.m3u8?token=xyz',
        renditions: [],
        expiresAt: '2026-08-11T10:15:00.000Z',
      });

      const result = await getPlaybackAuthorization('video-11');

      expect('fallback' in (result as object)).toBe(false);
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

  it('defaults to the adaptive masterUrl when no quality argument is supplied', () => {
    const auth = buildHls();

    // Every pre-existing caller passes three arguments. Auto has to be what
    // they keep getting, or adding the parameter would have silently changed
    // playback for code that never asked for a rendition.
    expect(resolvePlaybackSource(auth, 'token-123', true)).toEqual(
      resolvePlaybackSource(auth, 'token-123', true, AUTO_PLAYBACK_QUALITY)
    );
  });

  it('kind: "hls" + manual quality: plays that rendition\'s OWN variant playlist, not the master', () => {
    // THE assertion that manual selection is real. A variant playlist
    // advertises exactly one rendition, so the player can only fetch that
    // rendition's segments - this is a spec-level constraint, not a label.
    const auth = buildHls({
      renditions: [
        {
          quality: '360p',
          width: 360,
          height: 640,
          url: 'https://gateway.example.com/t/tok/360p/index.m3u8',
        },
        {
          quality: '720p',
          width: 720,
          height: 1280,
          url: 'https://gateway.example.com/t/tok/720p/index.m3u8',
        },
      ],
    });

    const source = resolvePlaybackSource(auth, 'token-123', true, {
      mode: 'manual',
      quality: '360p',
    });

    expect(source).toEqual({ uri: 'https://gateway.example.com/t/tok/360p/index.m3u8' });
    expect(source?.uri).not.toBe(auth.masterUrl);
  });

  it('kind: "hls" + back to auto: returns to the adaptive master, re-enabling ABR', () => {
    const auth = buildHls();

    expect(resolvePlaybackSource(auth, 'token-123', true, AUTO_PLAYBACK_QUALITY)).toEqual({
      uri: auth.masterUrl,
    });
  });

  it('kind: "hls" + a manual quality this authorization does not list: degrades to adaptive, never to null', () => {
    // Happens when a refreshed grant returns a re-transcoded ladder. Adaptive
    // playback is strictly better than a black frame, and
    // `resolveEffectiveQuality` makes the menu show Auto to match.
    const auth = buildHls();

    expect(
      resolvePlaybackSource(auth, 'token-123', true, { mode: 'manual', quality: '4320p' })
    ).toEqual({ uri: auth.masterUrl });
  });

  it('kind: "hls" + manual quality + HLS disabled: still null - the kill switch outranks a quality choice', () => {
    const auth = buildHls();

    expect(
      resolvePlaybackSource(auth, 'token-123', false, { mode: 'manual', quality: '720p' })
    ).toBeNull();
  });

  // ===== work unit "HLS MP4 FALLBACK" ==============================
  // Before this, an HLS authorization had exactly one playable source and
  // `resolvePlaybackSource` returned null whenever it could not be used.
  // These pin the second source, and that the first still wins.
  describe('MP4 fallback on an HLS authorization', () => {
    const FALLBACK = {
      playbackUrl: 'https://media.example.com/videos/video-1/source.mp4',
      requiresAuthHeader: false,
      expiresAt: '2026-08-11T10:15:00.000Z',
    } as const;

    it('still prefers HLS when HLS is usable, even though a fallback is present', () => {
      const auth = buildHls({ fallback: FALLBACK });

      expect(resolvePlaybackSource(auth, 'token-123', true)).toEqual({ uri: auth.masterUrl });
    });

    it('resolves the fallback MP4 when the kill switch is off - a REAL rollback, not "video unavailable"', () => {
      const auth = buildHls({ fallback: FALLBACK });

      expect(resolvePlaybackSource(auth, 'token-123', false)).toEqual({
        uri: FALLBACK.playbackUrl,
        headers: undefined,
      });
    });

    it('resolves the fallback MP4 when this runtime cannot play HLS (a browser with no HLS engine)', () => {
      const auth = buildHls({ fallback: FALLBACK });

      expect(
        resolvePlaybackSource(auth, 'token-123', true, AUTO_PLAYBACK_QUALITY, false)
      ).toEqual({ uri: FALLBACK.playbackUrl, headers: undefined });
    });

    it('attaches the Authorization header to a fallback that requires one - same rule as a legacy MP4', () => {
      const auth = buildHls({ fallback: { ...FALLBACK, requiresAuthHeader: true } });

      expect(
        resolvePlaybackSource(auth, 'token-123', true, AUTO_PLAYBACK_QUALITY, false)
      ).toEqual({
        uri: FALLBACK.playbackUrl,
        headers: { Authorization: 'Bearer token-123' },
      });
    });

    it('a manual quality choice never overrides the fallback once HLS is unusable', () => {
      const auth = buildHls({ fallback: FALLBACK });

      expect(
        resolvePlaybackSource(
          auth,
          'token-123',
          true,
          { mode: 'manual', quality: '720p' },
          false
        )
      ).toEqual({ uri: FALLBACK.playbackUrl, headers: undefined });
    });

    it('returns null - the pre-fallback behavior - when HLS is unusable and there is NO fallback', () => {
      const auth = buildHls();

      expect(
        resolvePlaybackSource(auth, 'token-123', true, AUTO_PLAYBACK_QUALITY, false)
      ).toBeNull();
    });
  });

  it('kind: "mp4" ignores a manual quality entirely - the MP4 path is byte-identical either way', () => {
    // A quality choice can never reach an MP4-backed video through the UI
    // (no options are offered for one), but the selector must not corrupt
    // that path even if one somehow arrived.
    const auth = buildMp4({ requiresAuthHeader: true });

    expect(
      resolvePlaybackSource(auth, 'token-123', true, { mode: 'manual', quality: '720p' })
    ).toEqual(resolvePlaybackSource(auth, 'token-123', true, AUTO_PLAYBACK_QUALITY));
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

  it('kind: "hls" + HLS disabled (kill switch) + no fallback offered: returns null', () => {
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
