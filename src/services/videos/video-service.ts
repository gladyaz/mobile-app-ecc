import { mockDramaVideos } from '@/data/mock-drama-videos';
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

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function videoMatchesSearch(video: Video, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const searchableValues = [
    video.title,
    video.caption,
    video.channelName,
    video.indonesianSubtitlePreview,
    video.category,
  ];

  return searchableValues.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function getVideoFeed(): readonly Video[] {
  // Future backend integration will fetch the personalized feed through the API client.
  return mockDramaVideos;
}

export function getVideoById(id: string): Video | undefined {
  // Future backend integration will fetch a single video by id from the API.
  return mockDramaVideos.find((video) => video.id === id);
}

export function searchVideos(
  query: string,
  category: VideoCategoryFilter = 'All'
): readonly Video[] {
  // Future backend integration can move search and category filters to query params.
  const normalizedQuery = normalizeSearchValue(query);

  return mockDramaVideos.filter((video) => {
    const matchesCategory = category === 'All' || video.category === category;
    const matchesSearch = videoMatchesSearch(video, normalizedQuery);

    return matchesCategory && matchesSearch;
  });
}

export function getSavedVideos(savedVideoIds: readonly string[]): readonly Video[] {
  // Future backend integration can return saved videos for the authenticated user.
  const savedVideoIdSet = new Set(savedVideoIds);

  return mockDramaVideos.filter((video) => savedVideoIdSet.has(video.id));
}

export function getCategories(): readonly VideoCategoryFilter[] {
  // Future backend integration may fetch dynamic editorial categories.
  return categoryFilters;
}
