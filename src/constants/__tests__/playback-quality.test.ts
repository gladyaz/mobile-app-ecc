import {
  AUTO_PLAYBACK_QUALITY,
  resolveEffectiveQuality,
  selectQualityOptions,
  type PlaybackQuality,
} from '@/constants/playback-quality';
import type { HlsPlaybackAuthorization, PlaybackAuthorization } from '@/types/playback';

// Mirrors the backend's real portrait ladder (`rendition-ladder.ts`): a
// 1080x1920 source produces 360x640 / 540x960 / 720x1280 / 1080x1920, named
// by SHORT side. Using the real shape matters here - a label derived from
// `height` instead of the short side would read "1920p".
function portraitRendition(quality: string, shortSide: number) {
  return {
    quality,
    width: shortSide,
    height: Math.round((shortSide * 16) / 9),
    url: `https://gateway.example.com/t/tok/${quality}/index.m3u8`,
  };
}

function buildHlsAuthorization(
  renditions: readonly ReturnType<typeof portraitRendition>[]
): HlsPlaybackAuthorization {
  return {
    kind: 'hls',
    masterUrl: 'https://gateway.example.com/t/tok/master.m3u8',
    renditions,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

const mp4Authorization: PlaybackAuthorization = {
  kind: 'mp4',
  playbackUrl: 'https://media.example.com/video-1.mp4',
  requiresAuthHeader: false,
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
};

describe('selectQualityOptions', () => {
  it('derives exactly the renditions the authorization lists, highest first', () => {
    // Arrange
    const auth = buildHlsAuthorization([
      portraitRendition('360p', 360),
      portraitRendition('1080p', 1080),
      portraitRendition('720p', 720),
    ]);

    // Act
    const options = selectQualityOptions(auth);

    // Assert
    expect(options.map((option) => option.quality)).toEqual(['1080p', '720p', '360p']);
  });

  it('never invents a rendition the backend did not produce', () => {
    // A source too small for the upper rungs yields a shorter ladder. The
    // menu must be shorter too - a 540p-capped video offering "1080p HD"
    // would be a control that cannot do what it claims.
    const auth = buildHlsAuthorization([
      portraitRendition('360p', 360),
      portraitRendition('540p', 540),
    ]);

    const options = selectQualityOptions(auth);

    expect(options.map((option) => option.quality)).toEqual(['540p', '360p']);
    expect(options.some((option) => option.quality === '720p')).toBe(false);
    expect(options.some((option) => option.quality === '1080p')).toBe(false);
  });

  it('marks only the 1080p rung as high definition, by SHORT side not height', () => {
    // The 720p portrait rung is 720x1280 - taller than 1080. Keying "HD" off
    // `height` would mark it (and every other rung) HD.
    const auth = buildHlsAuthorization([
      portraitRendition('720p', 720),
      portraitRendition('1080p', 1080),
    ]);

    const options = selectQualityOptions(auth);

    expect(options).toEqual([
      { quality: '1080p', shortSide: 1080, isHighDefinition: true },
      { quality: '720p', shortSide: 720, isHighDefinition: false },
    ]);
  });

  it('offers nothing for an MP4-backed video, which has one fixed stream', () => {
    expect(selectQualityOptions(mp4Authorization)).toEqual([]);
  });

  it('offers nothing before an authorization has arrived', () => {
    expect(selectQualityOptions(null)).toEqual([]);
  });

  it('offers nothing when a single rendition exists, rather than pretending there is a choice', () => {
    const auth = buildHlsAuthorization([portraitRendition('360p', 360)]);

    // "Auto" and the one rendition would be the same stream under two names.
    expect(selectQualityOptions(auth)).toEqual([]);
  });
});

describe('resolveEffectiveQuality', () => {
  const options = selectQualityOptions(
    buildHlsAuthorization([portraitRendition('360p', 360), portraitRendition('720p', 720)])
  );

  it('keeps auto as auto', () => {
    expect(resolveEffectiveQuality(AUTO_PLAYBACK_QUALITY, options)).toEqual({ mode: 'auto' });
  });

  it('keeps a manual choice that is still available', () => {
    const manual: PlaybackQuality = { mode: 'manual', quality: '720p' };

    expect(resolveEffectiveQuality(manual, options)).toBe(manual);
  });

  it('falls back to auto when the chosen rendition is gone, matching what the player does', () => {
    // `resolvePlaybackSource` plays the adaptive master when it cannot find
    // the pinned rendition. The menu has to agree, or it would keep a
    // checkmark on a rendition nothing is playing.
    const manual: PlaybackQuality = { mode: 'manual', quality: '1080p' };

    expect(resolveEffectiveQuality(manual, options)).toEqual({ mode: 'auto' });
  });
});
