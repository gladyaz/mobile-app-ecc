import type { Episode, EpisodeAccessType, Series } from '@/types/series';
import type { Video } from '@/types/video';

/** Episodes 1-5 are free; episode 6 onward is premium. No payment/credit logic exists yet. */
export const FREE_EPISODE_LIMIT = 5;

export function getEpisodeAccessType(episodeNumber: number): EpisodeAccessType {
  return episodeNumber <= FREE_EPISODE_LIMIT ? 'free' : 'premium';
}

function toEpisode(video: Video): Episode {
  return {
    videoId: video.id,
    seriesId: video.seriesId,
    episodeNumber: video.episodeNumber,
    title: video.title,
    thumbnailUrl: video.thumbnailUrl,
    playbackUrl: video.playbackUrl,
    durationSeconds: undefined,
    accessType: getEpisodeAccessType(video.episodeNumber),
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
