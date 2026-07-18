import type { VideoCategory } from '@/types/video';

export type EpisodeAccessType = 'free' | 'premium';

export type Episode = {
  readonly videoId: string;
  readonly seriesId: string;
  readonly episodeNumber: number;
  readonly title: string;
  readonly thumbnailUrl: string;
  readonly playbackUrl: string;
  readonly durationSeconds?: number;
  readonly accessType: EpisodeAccessType;
  readonly isAvailable: boolean;
  readonly hasEmbeddedIndonesianSubtitle: boolean;
};

export type Series = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: VideoCategory;
  readonly channelName: string;
  readonly coverUrl: string;
  readonly totalEpisodes: number;
  readonly episodeCount: number;
  readonly releaseStatus: 'ongoing' | 'completed';
  readonly episodes: readonly Episode[];
};
