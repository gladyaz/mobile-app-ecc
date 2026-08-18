import type { VideoAccessTier, VideoCategory } from '@/types/video';

/**
 * An episode's access state, as rendered by the episode list and enforced
 * by the premium gate. Deliberately an ALIAS of `VideoAccessTier` rather
 * than a second literal union: the value is copied straight from the
 * backend's `Video.accessTier` in `toEpisode`, so declaring it twice would
 * let the two drift the next time either side gains a tier.
 */
export type EpisodeAccessType = VideoAccessTier;

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
