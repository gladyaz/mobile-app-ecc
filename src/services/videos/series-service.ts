import type { Episode, Series } from '@/types/series';
import type { Video } from '@/types/video';

/**
 * Exported so Series Detail can shape `GET /series/:id`'s episodes with the
 * SAME rule the derived/mock path uses, instead of a second copy of it.
 *
 * Access state is COPIED from `video.accessTier`, the tier the backend
 * already resolved (backend commit 2f285d1). It is never computed here.
 *
 * This used to be `getEpisodeAccessType(video.episodeNumber)` - a local
 * `episodeNumber <= FREE_EPISODE_LIMIT` rule. That rule is gone, and must
 * not come back: the backend lets an admin set an explicit per-episode
 * override that beats the episode-number default, so episode 2 can be
 * premium and episode 8 can be free. Any client-side re-derivation would
 * contradict the very same resolver that guards `/stream`, and the lock the
 * user sees would stop predicting whether playback is actually allowed.
 */
export function toEpisode(video: Video): Episode {
  return {
    videoId: video.id,
    seriesId: video.seriesId,
    episodeNumber: video.episodeNumber,
    title: video.title,
    thumbnailUrl: video.thumbnailUrl,
    playbackUrl: video.playbackUrl,
    durationSeconds: undefined,
    accessType: video.accessTier,
    isAvailable: video.processingStatus === 'completed' && video.playbackUrl.length > 0,
    hasEmbeddedIndonesianSubtitle: video.hasEmbeddedIndonesianSubtitle,
  };
}

/**
 * Builds a Series record from its videos. All videos are assumed to share
 * the same seriesId; the series' title/category/channel/cover are taken
 * from the lowest-numbered episode. releaseStatus has no backing data yet,
 * so it is always reported as "ongoing".
 */
function buildSeries(seriesId: string, videos: readonly Video[]): Series {
  const episodes = [...videos].sort((a, b) => a.episodeNumber - b.episodeNumber).map(toEpisode);
  const representativeVideo = videos.reduce((earliest, video) =>
    video.episodeNumber < earliest.episodeNumber ? video : earliest
  );

  return {
    id: seriesId,
    title: representativeVideo.title,
    description: representativeVideo.caption,
    category: representativeVideo.category,
    channelName: representativeVideo.channelName,
    coverUrl: representativeVideo.thumbnailUrl,
    totalEpisodes: episodes.length,
    episodeCount: episodes.length,
    releaseStatus: 'ongoing',
    episodes,
  };
}

export function groupVideosIntoSeries(videos: readonly Video[]): readonly Series[] {
  const videosBySeriesId = new Map<string, Video[]>();

  for (const video of videos) {
    const existing = videosBySeriesId.get(video.seriesId);

    if (existing) {
      existing.push(video);
    } else {
      videosBySeriesId.set(video.seriesId, [video]);
    }
  }

  return Array.from(videosBySeriesId.entries()).map(([seriesId, seriesVideos]) =>
    buildSeries(seriesId, seriesVideos)
  );
}

export function getSeriesById(videos: readonly Video[], seriesId: string): Series | undefined {
  const seriesVideos = videos.filter((video) => video.seriesId === seriesId);

  if (seriesVideos.length === 0) {
    return undefined;
  }

  return buildSeries(seriesId, seriesVideos);
}

export function getNextEpisode(series: Series, currentEpisodeNumber: number): Episode | undefined {
  return series.episodes.find((episode) => episode.episodeNumber === currentEpisodeNumber + 1);
}
