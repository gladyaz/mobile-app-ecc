/**
 * Mirrors the real backend's watch-progress response shapes exactly (see
 * short-drama-backend `PUT /series/:id/progress` and `GET
 * /users/me/progress` endpoints). This is a faithful mirror of the REMOTE
 * shape - reshaping into the local store's format is the store layer's job,
 * not this service layer's.
 */
export type UserSeriesProgress = {
  readonly seriesId: string;
  readonly lastWatchedVideoId: string;
  readonly lastWatchedEpisodeNumber: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
};
