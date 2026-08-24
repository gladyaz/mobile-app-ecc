import { mapBackendVideoToVideo, type BackendVideoDto } from '@/services/videos/video-mapper';

function buildDto(overrides: Partial<BackendVideoDto> = {}): BackendVideoDto {
  return {
    id: 'video_001',
    seriesId: 'series_001',
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber: 1,
    channelName: 'Mandarin Drama ID',
    caption: 'Pertemuan pertama yang mengubah hidup Lin Yue.',
    category: 'CEO',
    storageKey: 'processed-videos/drama-china/series-a/ep-01-id-sub.mp4',
    playbackUrl: 'https://media.example.com/videos/video_001.mp4',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    likeCount: 12800,
    contentKind: 'drama',
    accessTier: 'free',
    ...overrides,
  };
}

describe('mapBackendVideoToVideo', () => {
  it('carries seriesId through to the mobile Video model', () => {
    const video = mapBackendVideoToVideo(buildDto({ seriesId: 'series_ceo_dingin' }));

    expect(video.seriesId).toBe('series_ceo_dingin');
  });

  it('throws when seriesId is missing or empty', () => {
    const dtoWithEmptySeriesId = buildDto({ seriesId: '' });

    expect(() => mapBackendVideoToVideo(dtoWithEmptySeriesId)).toThrow(/seriesId/);
  });

  it('normalizes a lowercase backend category to the canonical casing', () => {
    const video = mapBackendVideoToVideo(buildDto({ category: 'romance' }));

    expect(video.category).toBe('Romance');
  });

  it('throws in development when category does not match any known category, case-insensitively', () => {
    const dtoWithUnknownCategory = buildDto({ category: 'not-a-real-category' });

    expect(() => mapBackendVideoToVideo(dtoWithUnknownCategory)).toThrow(/category/);
  });

  it('degrades an unrecognised category to Drama in production, instead of taking the feed down', () => {
    // The dev-time throw above is the other half of this policy. It used to be
    // the ONLY half: a bare assertField that threw unconditionally. Because
    // `getVideoFeed` maps a whole page in one pass, ONE row carrying a category
    // the client had never heard of blanked the ENTIRE feed for every installed
    // app - and the way such a row comes to exist is somebody adding a category
    // on the backend, an ordinary additive content operation that nobody would
    // expect to break shipped clients. Category is a display/filter label; it
    // gates no access and no playback, so degrading it is cosmetic.
    const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    try {
      expect(mapBackendVideoToVideo(buildDto({ category: 'Thriller' })).category).toBe('Drama');
      expect(
        mapBackendVideoToVideo(
          buildDto({ category: undefined as unknown as BackendVideoDto['category'] })
        ).category
      ).toBe('Drama');
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
    }
  });
});
