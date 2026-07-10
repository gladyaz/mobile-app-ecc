import type { Subtitle } from '@/types/subtitle';

export type VideoCategory = 'Romance' | 'Revenge' | 'Family' | 'CEO' | 'Historical';

export type Video = {
  readonly id: string;
  readonly videoUrl: string;
  readonly title: string;
  readonly episodeNumber: number;
  readonly channelName: string;
  readonly category: VideoCategory;
  readonly caption: string;
  readonly mandarinSubtitlePreview: string;
  readonly indonesianSubtitlePreview: string;
  readonly indonesianSubtitles: readonly Subtitle[];
  readonly likeCount: number;
  readonly isSaved: boolean;
};
