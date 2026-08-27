/**
 * V1 HLS PLAYBACK CONTRACT LOCK.
 *
 * `GET /videos/:id/playback` answers one of TWO deliberately un-merged
 * shapes, and the discriminant is the presence of a `type` field rather than
 * a value inside a shared envelope. That is the most drift-prone thing in
 * this contract: a row tagged `type: 'hls'` mid-migration, that still
 * carries a legacy triple, would silently play an MP4 while the backend
 * believed it served HLS - and playback would look fine.
 *
 * Everything here goes through the REAL parser and the REAL source
 * resolver. Nothing reconstructs a storage path, and nothing may fabricate a
 * rendition the backend did not send.
 */
import { AUTO_PLAYBACK_QUALITY, selectQualityOptions } from '@/constants/playback-quality';
import { request } from '@/services/api/client';
import {
  HLS_EMPTY_MASTER_URL,
  HLS_FULL_LADDER,
  HLS_MISSING_MASTER_URL,
  HLS_NON_FINITE_DIMENSIONS,
  HLS_NO_1080,
  HLS_RENDITION_MISSING_DIMENSIONS,
  HLS_SINGLE_RENDITION,
  HLS_STRING_DIMENSIONS,
  HLS_TAGGED_BUT_LEGACY_SHAPED,
  HLS_UNPARSEABLE_EXPIRY,
  HLS_WITH_UNKNOWN_EXTRA_FIELDS,
  MP4_EMPTY_PLAYBACK_URL,
  MP4_LOCAL_FREE,
  MP4_LOCAL_PREMIUM,
  MP4_MISSING_REQUIRES_AUTH_HEADER,
  MP4_R2_PRESIGNED,
  PLAYBACK_FUTURE_KIND,
  PLAYBACK_NOT_AN_OBJECT,
} from '@/services/contract/fixtures/playback-fixtures';
import {
  V1_HLS_GUARANTEED_RUNG,
  V1_HLS_LADDER,
  V1_HLS_OPTIONAL_RUNG,
  V1_HLS_RENDITION_FIELDS,
  V1_PLAYBACK_ENDPOINTS,
} from '@/services/contract/v1-contract-manifest';
import { getPlaybackAuthorization, resolvePlaybackSource } from '@/services/videos/video-service';
import type { HlsPlaybackAuthorization } from '@/types/playback';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return { ...actual, request: jest.fn() };
});

jest.mock('@/services/demo/demo-mode', () => ({ isDemoMode: jest.fn(() => false) }));

const mockedRequest = request as jest.MockedFunction<typeof request>;

const ORIGINAL_USE_MOCK_DATA = process.env.EXPO_PUBLIC_USE_MOCK_DATA;

beforeEach(() => {
  process.env.EXPO_PUBLIC_USE_MOCK_DATA = 'false';
});

afterEach(() => {
  process.env.EXPO_PUBLIC_USE_MOCK_DATA = ORIGINAL_USE_MOCK_DATA;
});

async function authorize(payload: unknown) {
  mockedRequest.mockResolvedValueOnce(payload);

  return getPlaybackAuthorization('vid_fixture');
}

async function expectShapeMismatch(payload: unknown): Promise<void> {
  mockedRequest.mockResolvedValueOnce(payload);

  await expect(getPlaybackAuthorization('vid_fixture')).rejects.toThrow(
    /did not match the expected shape/
  );
}

describe('the HLS branch', () => {
  it('normalizes the canonical four-rung response and echoes every field verbatim', async () => {
    const auth = (await authorize(HLS_FULL_LADDER)) as HlsPlaybackAuthorization;

    expect(auth.kind).toBe('hls');
    expect(auth.masterUrl).toBe(HLS_FULL_LADDER.masterUrl);
    expect(auth.expiresAt).toBe(HLS_FULL_LADDER.expiresAt);
    expect(auth.renditions).toHaveLength(4);
    expect(auth.renditions.map((rendition) => rendition.quality)).toEqual(V1_HLS_LADDER);
  });

  it('carries every field the client reads off a rendition', async () => {
    const auth = (await authorize(HLS_FULL_LADDER)) as HlsPlaybackAuthorization;

    V1_HLS_RENDITION_FIELDS.forEach((field) => {
      auth.renditions.forEach((rendition) =>
        expect(rendition).toHaveProperty(field)
      );
    });
  });

  it('plays the adaptive master under Auto, with NO headers', async () => {
    const auth = await authorize(HLS_FULL_LADDER);

    const source = resolvePlaybackSource(auth, 'access-token', true, AUTO_PLAYBACK_QUALITY);

    // The gateway token is path-embedded, so an Authorization header would
    // break this the same way it breaks a presigned R2 URL.
    expect(source).toEqual({ uri: HLS_FULL_LADDER.masterUrl });
  });

  it('plays a manual quality from the BACKEND\'s own variant URL, never a constructed one', async () => {
    const auth = await authorize(HLS_FULL_LADDER);

    const source = resolvePlaybackSource(auth, 'access-token', true, {
      mode: 'manual',
      quality: '720p',
    });

    expect(source?.uri).toBe(HLS_FULL_LADDER.renditions[2].url);
  });

  it('offers 1080p only when the backend actually produced it', async () => {
    const withTop = await authorize(HLS_FULL_LADDER);
    const withoutTop = await authorize(HLS_NO_1080);

    expect(selectQualityOptions(withTop).map((option) => option.quality)).toContain(
      V1_HLS_OPTIONAL_RUNG
    );
    expect(selectQualityOptions(withoutTop).map((option) => option.quality)).not.toContain(
      V1_HLS_OPTIONAL_RUNG
    );
    // The three rungs a 720-tall source does produce are all still there.
    expect(selectQualityOptions(withoutTop).map((option) => option.quality)).toEqual([
      '720p',
      '540p',
      '360p',
    ]);
  });

  it('cannot fabricate a rendition the authorization does not list', async () => {
    const auth = await authorize(HLS_NO_1080);

    const source = resolvePlaybackSource(auth, 'access-token', true, {
      mode: 'manual',
      quality: V1_HLS_OPTIONAL_RUNG,
    });

    // Degrades to the adaptive master rather than guessing a `/1080p/`
    // path - and `resolveEffectiveQuality` makes the MENU agree by showing
    // Auto, so the UI never claims a rendition the player is not on.
    expect(source?.uri).toBe(HLS_NO_1080.masterUrl);
  });

  it('labels rungs from the SHORT side, because these sources are portrait', async () => {
    const auth = await authorize(HLS_FULL_LADDER);

    const [top] = selectQualityOptions(auth);

    // A 1080p rung of a 1080x1920 source is 1080 WIDE and 1920 tall; a label
    // derived from `height` would read "1920p".
    expect(top.quality).toBe('1080p');
    expect(top.shortSide).toBe(1080);
    expect(top.isHighDefinition).toBe(true);
  });

  it('offers no quality control at all below two rungs - there is nothing to choose between', async () => {
    const auth = await authorize(HLS_SINGLE_RENDITION);

    expect(selectQualityOptions(auth)).toEqual([]);
    expect((auth as HlsPlaybackAuthorization).renditions[0].quality).toBe(
      V1_HLS_GUARANTEED_RUNG
    );
  });

  it('tolerates unknown extra fields at both levels and still plays', async () => {
    const auth = (await authorize(HLS_WITH_UNKNOWN_EXTRA_FIELDS)) as HlsPlaybackAuthorization;

    expect(auth.kind).toBe('hls');
    expect(auth.renditions).toHaveLength(2);
    expect(resolvePlaybackSource(auth, undefined, true)?.uri).toBe(auth.masterUrl);
  });
});

describe('the MP4 / legacy branch', () => {
  it('normalizes a FREE local row and attaches no header - a guest has none to attach', async () => {
    const auth = await authorize(MP4_LOCAL_FREE);

    expect(auth).toEqual({
      kind: 'mp4',
      playbackUrl: MP4_LOCAL_FREE.playbackUrl,
      requiresAuthHeader: false,
      expiresAt: MP4_LOCAL_FREE.expiresAt,
    });
    expect(resolvePlaybackSource(auth, undefined, true)).toEqual({
      uri: MP4_LOCAL_FREE.playbackUrl,
      headers: undefined,
    });
  });

  it('attaches the bearer token for a PREMIUM local row, which /stream still refuses without one', async () => {
    const auth = await authorize(MP4_LOCAL_PREMIUM);

    expect(resolvePlaybackSource(auth, 'access-token', true)).toEqual({
      uri: MP4_LOCAL_PREMIUM.playbackUrl,
      headers: { Authorization: 'Bearer access-token' },
    });
  });

  it('never attaches a header to a presigned URL, which is what breaks one', async () => {
    const auth = await authorize(MP4_R2_PRESIGNED);

    expect(resolvePlaybackSource(auth, 'access-token', true)?.headers).toBeUndefined();
  });

  it('offers no quality ladder for an MP4 - there is no HLS behind it to pretend about', async () => {
    expect(selectQualityOptions(await authorize(MP4_R2_PRESIGNED))).toEqual([]);
  });
});

describe('a drifted or malformed playback response fails visibly', () => {
  it('refuses an HLS-tagged row that also carries a full legacy triple', async () => {
    // The partial-rollout trap. Falling through to the legacy branch would
    // play an MP4 while the backend believed it served HLS, hiding a
    // half-finished migration behind working playback.
    await expectShapeMismatch(HLS_TAGGED_BUT_LEGACY_SHAPED);
  });

  it('refuses an HLS response with no master playlist to play', async () => {
    await expectShapeMismatch(HLS_MISSING_MASTER_URL);
    await expectShapeMismatch(HLS_EMPTY_MASTER_URL);
  });

  it('refuses the WHOLE ladder when one rung is malformed, rather than shortening it', async () => {
    // A silently shortened ladder is a quality menu that lies about what the
    // backend produced.
    await expectShapeMismatch(HLS_RENDITION_MISSING_DIMENSIONS);
  });

  it('refuses stringified and non-finite dimensions alike', async () => {
    await expectShapeMismatch(HLS_STRING_DIMENSIONS);
    await expectShapeMismatch(HLS_NON_FINITE_DIMENSIONS);
  });

  it('refuses an expiry that is not a parseable instant', async () => {
    // `expiresAt` is what schedules the pre-expiry re-authorization; an
    // unparseable one would silently disable it.
    await expectShapeMismatch(HLS_UNPARSEABLE_EXPIRY);
  });

  it('refuses a legacy response missing the flag that decides the header', async () => {
    await expectShapeMismatch(MP4_MISSING_REQUIRES_AUTH_HEADER);
    await expectShapeMismatch(MP4_EMPTY_PLAYBACK_URL);
  });

  it('refuses a FUTURE third kind rather than guessing at a format it cannot play', async () => {
    await expectShapeMismatch(PLAYBACK_FUTURE_KIND);
    await expectShapeMismatch(PLAYBACK_NOT_AN_OBJECT);
  });

  it('never puts a signed URL or a gateway token into the thrown message', async () => {
    mockedRequest.mockResolvedValueOnce(HLS_MISSING_MASTER_URL);

    await expect(getPlaybackAuthorization('vid_fixture')).rejects.not.toThrow(
      /fixture-gateway-token/
    );
  });
});

describe('the HLS kill switch is a refusal, not a fallback', () => {
  it('returns null for an HLS authorization when HLS is disabled', async () => {
    const auth = await authorize(HLS_FULL_LADDER);

    // There is no MP4 URL hidden inside an HLS response to fall back to, so
    // this resolves to the honest "video unavailable" state rather than a
    // reconstructed path.
    expect(resolvePlaybackSource(auth, 'access-token', false)).toBeNull();
  });

  it('leaves the MP4 branch untouched by the flag either way', async () => {
    const auth = await authorize(MP4_LOCAL_FREE);

    expect(resolvePlaybackSource(auth, undefined, false)).toEqual(
      resolvePlaybackSource(auth, undefined, true)
    );
  });
});

describe('the playback endpoint manifest', () => {
  it('declares the single playback route, sent with the auth-refresh behaviour attached', async () => {
    expect(V1_PLAYBACK_ENDPOINTS).toHaveLength(1);
    expect(V1_PLAYBACK_ENDPOINTS[0].requiresAuth).toBe(true);

    await authorize(HLS_FULL_LADDER);

    const [path, options, config] = mockedRequest.mock.calls[0];

    expect(path).toBe('videos/vid_fixture/playback');
    expect(options?.method).toBe('GET');
    // NOT "refuse without a token": the backend guards this route optionally,
    // and `requiresAuth` is what keeps refresh-and-retry-once on a 401 -
    // dropping it would silently turn an expired session into an anonymous
    // request, the exact downgrade the backend's guard refuses to make.
    expect(config).toEqual({ requiresAuth: true });
  });
});
