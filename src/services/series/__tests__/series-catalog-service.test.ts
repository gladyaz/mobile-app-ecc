import { ApiError } from '@/services/api/client';
import { getSeriesCatalog, getSeriesDetail } from '@/services/series/series-catalog-service';
import {
  mapBackendSeries,
  mapBackendSeriesDetail,
  type BackendSeriesDetailDto,
  type BackendSeriesDto,
} from '@/services/series/series-mapper';
import type { BackendVideoDto } from '@/services/videos/video-mapper';

const mockRequest = jest.fn();
const mockShouldUseMockData = jest.fn(() => false);
const mockGetVideoFeed = jest.fn();

jest.mock('@/services/videos/video-service', () => ({
  shouldUseMockData: () => mockShouldUseMockData(),
  getVideoFeed: () => mockGetVideoFeed(),
}));

jest.mock('@/services/api/client', () => {
  class MockApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  return {
    ApiError: MockApiError,
    request: (...args: unknown[]) => mockRequest(...args),
  };
});

/** The canonical title the backend curates - no "- Episode 1" suffix. */
const CANONICAL_TITLE = 'Malapetaka Datang: Benteng Bergerakku';

function buildSeriesDto(overrides: Partial<BackendSeriesDto> = {}): BackendSeriesDto {
  return {
    id: 'series-104',
    title: CANONICAL_TITLE,
    coverUrl: 'https://r2.example.com/admin-series/series-104/cover/abc?X-Amz-Expires=3600',
    // The backend sends categories lower-cased.
    category: 'action',
    sourceLanguage: 'zh',
    episodeCount: 10,
    totalLikes: 716,
    hasPremiumEpisodes: true,
    ...overrides,
  };
}

function buildEpisodeDto(episodeNumber: number): BackendVideoDto {
  return {
    id: `video-104-${String(episodeNumber).padStart(2, '0')}`,
    seriesId: 'series-104',
    title: `${CANONICAL_TITLE} - Episode ${episodeNumber}`,
    episodeNumber,
    channelName: 'VideoDracin Originals',
    caption: `Episode ${episodeNumber} dari ${CANONICAL_TITLE}.`,
    category: 'action',
    storageKey: `Series 104/${episodeNumber}_subtitled.mp4`,
    playbackUrl: `http://localhost:3000/videos/video-104-${episodeNumber}/stream`,
    sourceLanguage: 'zh',
    hasEmbeddedIndonesianSubtitle: true,
    likeCount: 83,
    contentKind: 'drama',
  };
}

describe('mapBackendSeries', () => {
  it('preserves the canonical title verbatim', () => {
    const series = mapBackendSeries(buildSeriesDto());

    expect(series.title).toBe(CANONICAL_TITLE);
    // The episode-derived title this endpoint replaces ended with a suffix.
    expect(series.title).not.toMatch(/Episode/);
  });

  it('maps every authoritative aggregate straight through', () => {
    const series = mapBackendSeries(buildSeriesDto());

    expect(series).toEqual({
      id: 'series-104',
      title: CANONICAL_TITLE,
      coverUrl: 'https://r2.example.com/admin-series/series-104/cover/abc?X-Amz-Expires=3600',
      category: 'Action',
      sourceLanguage: 'zh',
      episodeCount: 10,
      totalLikes: 716,
      hasPremiumEpisodes: true,
    });
  });

  it('normalizes the lower-cased wire category to the mobile union', () => {
    expect(mapBackendSeries(buildSeriesDto({ category: 'romance' })).category).toBe('Romance');
    expect(mapBackendSeries(buildSeriesDto({ category: 'comedy' })).category).toBe('Comedy');
  });

  it('keeps a null coverUrl as null instead of coercing it to a string', () => {
    expect(mapBackendSeries(buildSeriesDto({ coverUrl: null })).coverUrl).toBeNull();
    expect(mapBackendSeries(buildSeriesDto({ coverUrl: '' })).coverUrl).toBeNull();
  });

  it('keeps an absent or unknown category as null rather than guessing one', () => {
    expect(mapBackendSeries(buildSeriesDto({ category: null })).category).toBeNull();
    expect(mapBackendSeries(buildSeriesDto({ category: 'telenovela' })).category).toBeNull();
  });

  it('rejects a payload missing a field the UI depends on', () => {
    expect(() => mapBackendSeries(buildSeriesDto({ title: '' }))).toThrow(/title/);
    expect(() =>
      mapBackendSeries({ ...buildSeriesDto(), totalLikes: undefined as unknown as number })
    ).toThrow(/totalLikes/);
  });
});

describe('mapBackendSeriesDetail', () => {
  it('maps episodes through the shared video mapper in backend order', () => {
    const dto: BackendSeriesDetailDto = {
      ...buildSeriesDto(),
      episodes: [1, 2, 3].map(buildEpisodeDto),
    };

    const detail = mapBackendSeriesDetail(dto);

    expect(detail.title).toBe(CANONICAL_TITLE);
    expect(detail.episodes).toHaveLength(3);
    expect(detail.episodes.map((episode) => episode.episodeNumber)).toEqual([1, 2, 3]);
    expect(detail.episodes[0].playbackUrl).toBe(dto.episodes[0].playbackUrl);
    expect(detail.episodes[0].contentKind).toBe('drama');
  });

  it('does not re-sort the episodes the backend already ordered', () => {
    const dto: BackendSeriesDetailDto = {
      ...buildSeriesDto(),
      episodes: [3, 1, 2].map(buildEpisodeDto),
    };

    expect(mapBackendSeriesDetail(dto).episodes.map((e) => e.episodeNumber)).toEqual([3, 1, 2]);
  });
});

beforeEach(() => {
  mockShouldUseMockData.mockReturnValue(false);
});

describe('getSeriesCatalog', () => {
  it('requests GET /series and maps the items envelope', async () => {
    mockRequest.mockResolvedValueOnce({ items: [buildSeriesDto()] });

    const catalog = await getSeriesCatalog();

    expect(mockRequest).toHaveBeenCalledWith('series');
    expect(catalog).toHaveLength(1);
    expect(catalog[0].title).toBe(CANONICAL_TITLE);
  });

  it('returns every item with no cap, slice or pagination', async () => {
    const items = ['series-010', 'series-101', 'series-104', 'series-105'].map((id) =>
      buildSeriesDto({ id })
    );
    mockRequest.mockResolvedValueOnce({ items });

    const catalog = await getSeriesCatalog();

    expect(catalog.map((series) => series.id)).toEqual([
      'series-010',
      'series-101',
      'series-104',
      'series-105',
    ]);
  });

  it('fails loudly if the envelope is not { items: [] }', async () => {
    mockRequest.mockResolvedValueOnce([buildSeriesDto()]);

    await expect(getSeriesCatalog()).rejects.toThrow(/items/);
  });

  it('propagates an API failure instead of swallowing it', async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(500, 'SERVER_ERROR', 'boom'));

    await expect(getSeriesCatalog()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getSeriesDetail', () => {
  it('requests GET /series/:id and maps the detail', async () => {
    mockRequest.mockResolvedValueOnce({
      ...buildSeriesDto(),
      episodes: [1, 2].map(buildEpisodeDto),
    });

    const detail = await getSeriesDetail('series-104');

    expect(mockRequest).toHaveBeenCalledWith('series/series-104');
    expect(detail?.title).toBe(CANONICAL_TITLE);
    expect(detail?.episodes).toHaveLength(2);
  });

  it('encodes an id that would otherwise break the path', async () => {
    mockRequest.mockResolvedValueOnce({ ...buildSeriesDto(), episodes: [] });

    await getSeriesDetail('series 104/../secret');

    expect(mockRequest).toHaveBeenCalledWith('series/series%20104%2F..%2Fsecret');
  });

  it('resolves to undefined for a 404 SERIES_NOT_FOUND', async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(404, 'SERIES_NOT_FOUND', 'Series not found'));

    await expect(getSeriesDetail('nope')).resolves.toBeUndefined();
  });

  it('propagates any other API error to the caller error state', async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(500, 'SERVER_ERROR', 'boom'));

    await expect(getSeriesDetail('series-104')).rejects.toBeInstanceOf(ApiError);
  });
});


describe('offline / demo mode', () => {
  it('never touches the network for the catalog', async () => {
    mockShouldUseMockData.mockReturnValue(true);
    mockGetVideoFeed.mockResolvedValueOnce([
      {
        id: 'mock-ep-1',
        seriesId: 'series-mock',
        storageKey: 'k',
        playbackUrl: 'file://mock.mp4',
        thumbnailUrl: 'file://mock.jpg',
        title: 'Drama Offline',
        episodeNumber: 1,
        channelName: 'Bundled',
        category: 'Romance',
        sourceLanguage: 'Mandarin',
        hasEmbeddedIndonesianSubtitle: true,
        processingStatus: 'completed',
        caption: 'c',
        likeCount: 12,
        isSaved: false,
        contentKind: 'drama',
      },
    ]);

    const catalog = await getSeriesCatalog();

    expect(mockRequest).not.toHaveBeenCalled();
    expect(catalog).toHaveLength(1);
    expect(catalog[0].title).toBe('Drama Offline');
    expect(catalog[0].totalLikes).toBe(12);
  });

  it('never touches the network for a detail either', async () => {
    mockShouldUseMockData.mockReturnValue(true);
    mockGetVideoFeed.mockResolvedValueOnce([
      {
        id: 'mock-ep-1',
        seriesId: 'series-mock',
        storageKey: 'k',
        playbackUrl: 'file://mock.mp4',
        thumbnailUrl: 'file://mock.jpg',
        title: 'Drama Offline',
        episodeNumber: 1,
        channelName: 'Bundled',
        category: 'Romance',
        sourceLanguage: 'Mandarin',
        hasEmbeddedIndonesianSubtitle: true,
        processingStatus: 'completed',
        caption: 'c',
        likeCount: 12,
        isSaved: false,
        contentKind: 'drama',
      },
    ]);

    const detail = await getSeriesDetail('series-mock');

    expect(mockRequest).not.toHaveBeenCalled();
    expect(detail?.episodes).toHaveLength(1);
  });
});
