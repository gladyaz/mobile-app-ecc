import type { Subtitle } from '@/types/subtitle';
import type { ProcessingStatus } from '@/types/processing';

export type VideoCategory = 'Romance' | 'Revenge' | 'Family' | 'CEO' | 'Historical';

export type Video = {
  readonly id: string;
  readonly storageKey: string;
  readonly playbackUrl: string;
  readonly thumbnailUrl: string;
  readonly subtitleTrackUrl: string;
  readonly title: string;
  readonly episodeNumber: number;
  readonly channelName: string;
  readonly category: VideoCategory;
  readonly sourceLanguage: string;
  readonly subtitleLanguage: string;
  readonly processingStatus: ProcessingStatus;
  readonly caption: string;
  readonly mandarinSubtitlePreview: string;
  readonly indonesianSubtitlePreview: string;
  readonly indonesianSubtitles: readonly Subtitle[];
  readonly likeCount: number;
  readonly isSaved: boolean;
};
