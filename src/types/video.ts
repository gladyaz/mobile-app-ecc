import type { ProcessingStatus } from '@/types/processing';

export type VideoCategory = 'Romance' | 'Revenge' | 'Family' | 'CEO' | 'Historical';

export type Video = {
  readonly id: string;
  readonly seriesId: string;
  readonly storageKey: string;
  readonly playbackUrl: string;
  readonly thumbnailUrl: string;
  readonly width?: number;
  readonly height?: number;
  readonly title: string;
  readonly episodeNumber: number;
  readonly channelName: string;
  readonly category: VideoCategory;
  readonly sourceLanguage: string;
  readonly hasEmbeddedIndonesianSubtitle: boolean;
  readonly processingStatus: ProcessingStatus;
  readonly caption: string;
  readonly likeCount: number;
  readonly isSaved: boolean;
};
