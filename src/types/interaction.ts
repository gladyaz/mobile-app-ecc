/**
 * Mirrors the real backend's like/save interaction response shapes exactly
 * (see short-drama-backend `/videos/:id/like`, `/videos/:id/save`, and
 * `/users/me/interactions` endpoints). This is a faithful mirror of the
 * REMOTE shape - reshaping into the local store's `Record<videoId, ...>`
 * format is the store layer's job, not this service layer's.
 */
export type LikeResponse = {
  readonly videoId: string;
  readonly isLiked: boolean;
  readonly likeCount: number;
};

export type SaveResponse = {
  readonly videoId: string;
  readonly isSaved: boolean;
};

export type UserInteraction = {
  readonly videoId: string;
  readonly isLiked: boolean;
  readonly isSaved: boolean;
};
