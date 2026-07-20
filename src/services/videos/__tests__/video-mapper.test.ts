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

  it('throws when category does not match any known category, case-insensitively', () => {
    const dtoWithUnknownCategory = buildDto({ category: 'not-a-real-category' });

    expect(() => mapBackendVideoToVideo(dtoWithUnknownCategory)).toThrow(/category/);
  });
});
