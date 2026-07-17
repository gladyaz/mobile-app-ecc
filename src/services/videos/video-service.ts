import { mockDramaVideos } from '@/data/mock-drama-videos';
import { ApiError, request } from '@/services/api/client';
import { mapBackendVideoToVideo, type BackendVideoDto } from '@/services/videos/video-mapper';
import type { Video, VideoCategory } from '@/types/video';

export type VideoCategoryFilter = 'All' | VideoCategory;

const categoryFilters: readonly VideoCategoryFilter[] = [
  'All',
  'Romance',
  'Revenge',
  'Family',
  'CEO',
  'Historical',
];

function shouldUseMockData(): boolean {
  return process.env.EXPO_PUBLIC_USE_MOCK_DATA === 'true';
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function videoMatchesSearch(video: Video, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const searchableValues = [video.title, video.caption, video.channelName, video.category];

  return searchableValues.some((value) => value.toLowerCase().includes(normalizedQuery));
}

/**
 * Fetches the video feed from the backend, or resolves the bundled mock
 * data when EXPO_PUBLIC_USE_MOCK_DATA=true. Real API errors are not caught
 * here and are not silently replaced with mock data; callers (the video
 * catalog provider) surface them as a visible error state.
 */
export async function getVideoFeed(): Promise<readonly Video[]> {
  if (shouldUseMockData()) {
    return mockDramaVideos;
  }

  const feed = await request<readonly BackendVideoDto[]>('videos/feed');

  return feed.map(mapBackendVideoToVideo);
}

export async function getVideoById(id: string): Promise<Video | undefined> {
  if (shouldUseMockData()) {
    return mockDramaVideos.find((video) => video.id === id);
  }

  try {
    const dto = await request<BackendVideoDto>(`videos/${id}`);

    return mapBackendVideoToVideo(dto);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return undefined;
    }

    throw error;
  }
}

export function searchVideos(
  videos: readonly Video[],
  query: string,
  category: VideoCategoryFilter = 'All'
): readonly Video[] {
  const normalizedQuery = normalizeSearchValue(query);

  return videos.filter((video) => {
    const matchesCategory = category === 'All' || video.category === category;
    const matchesSearch = videoMatchesSearch(video, normalizedQuery);

    return matchesCategory && matchesSearch;
  });
}

/**
 * Resolves saved video IDs against the given catalog. IDs with no matching
 * video in the catalog (e.g. removed from the backend) are safely skipped.
 */
export function getSavedVideos(
  videos: readonly Video[],
  savedVideoIds: readonly string[]
): readonly Video[] {
  const savedVideoIdSet = new Set(savedVideoIds);

  return videos.filter((video) => savedVideoIdSet.has(video.id));
}

export function getCategories(): readonly VideoCategoryFilter[] {
  return categoryFilters;
}
