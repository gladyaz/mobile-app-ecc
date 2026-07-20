import type { Video, VideoCategory } from '@/types/video';

export type BackendVideoDto = {
  readonly id: string;
  readonly seriesId: string;
  readonly title: string;
  readonly episodeNumber: number;
  readonly channelName: string;
  readonly caption: string;
  readonly category: string;
  readonly storageKey: string;
  readonly playbackUrl: string;
  readonly thumbnailUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly sourceLanguage: string;
  readonly hasEmbeddedIndonesianSubtitle: boolean;
  readonly likeCount: number;
  readonly durationSeconds?: number;
};

const VIDEO_CATEGORIES: readonly VideoCategory[] = [
  'Romance',
  'Revenge',
  'Family',
  'CEO',
  'Historical',
  'Action',
];

/**
 * Backend category casing has been observed to vary (e.g. "romance" instead
 * of "Romance"); match case-insensitively and normalize to the mobile
 * app's canonical casing instead of rejecting an otherwise-valid category.
 */
function normalizeCategory(value: string): VideoCategory | undefined {
  return VIDEO_CATEGORIES.find(
    (category) => category.toLowerCase() === value.toLowerCase()
  );
}

function assertField(condition: boolean, fieldName: string, dto: unknown): void {
  if (!condition) {
    throw new Error(
      `[video-mapper] Backend video is missing or has an invalid "${fieldName}" field: ${JSON.stringify(dto)}`
    );
  }
}

/**
 * Maps a raw backend video DTO to the mobile Video model. Validates the
 * fields the UI actually depends on so a malformed backend response fails
 * loudly here instead of silently rendering a broken feed item.
 *
 * storageKey is a backend-only identifier and is never used for playback;
 * playback always uses playbackUrl.
 */
export function mapBackendVideoToVideo(dto: BackendVideoDto): Video {
  assertField(typeof dto.id === 'string' && dto.id.length > 0, 'id', dto);
  assertField(typeof dto.seriesId === 'string' && dto.seriesId.length > 0, 'seriesId', dto);
  assertField(typeof dto.title === 'string' && dto.title.length > 0, 'title', dto);
  assertField(typeof dto.episodeNumber === 'number', 'episodeNumber', dto);
  assertField(typeof dto.channelName === 'string', 'channelName', dto);
  assertField(typeof dto.caption === 'string', 'caption', dto);
  const normalizedCategory =
    typeof dto.category === 'string' ? normalizeCategory(dto.category) : undefined;

  assertField(normalizedCategory !== undefined, 'category', dto);
  assertField(typeof dto.storageKey === 'string', 'storageKey', dto);
  assertField(
    typeof dto.playbackUrl === 'string' && dto.playbackUrl.length > 0,
    'playbackUrl',
    dto
  );
  assertField(typeof dto.sourceLanguage === 'string', 'sourceLanguage', dto);
  assertField(
    typeof dto.hasEmbeddedIndonesianSubtitle === 'boolean',
    'hasEmbeddedIndonesianSubtitle',
    dto
  );
  assertField(typeof dto.likeCount === 'number', 'likeCount', dto);

  return {
    id: dto.id,
    seriesId: dto.seriesId,
    storageKey: dto.storageKey,
    playbackUrl: dto.playbackUrl,
    thumbnailUrl: dto.thumbnailUrl ?? '',
    width: dto.width,
    height: dto.height,
    title: dto.title,
    episodeNumber: dto.episodeNumber,
    channelName: dto.channelName,
    category: normalizedCategory as VideoCategory,
    sourceLanguage: dto.sourceLanguage,
    hasEmbeddedIndonesianSubtitle: dto.hasEmbeddedIndonesianSubtitle,
    // The feed only returns playable videos, so treat every backend-fetched
    // video as completed; the backend does not include processing status here.
    processingStatus: 'completed',
    caption: dto.caption,
    likeCount: dto.likeCount,
    // Save state is tracked locally by useVideoInteractions, not the backend.
    isSaved: false,
  };
}
