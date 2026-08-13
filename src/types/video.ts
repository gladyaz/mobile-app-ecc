import type { ProcessingStatus } from '@/types/processing';

export type VideoCategory =
  | 'Romance'
  | 'Revenge'
  | 'Family'
  | 'CEO'
  | 'Historical'
  | 'Action'
  | 'Comedy'
  | 'Drama';

/**
 * Explicit catalog classification, mirroring the backend contract
 * (`Video.contentKind`, backend commit 91bade9).
 *
 * `drama`      - real, user-facing content.
 * `qa_fixture` - an internal technical fixture the backend keeps in the
 *                catalog on purpose (the 11R HLS sample, a disposable admin
 *                upload). The API serves them deliberately; excluding them
 *                from a consumer catalog is this client's job.
 *
 * READ from the backend, never inferred. Title, channelName, sourceLanguage,
 * storageKey, seriesId and dimensions were all evaluated and rejected as
 * discriminators - see `video-mapper.ts`.
 */
export type VideoContentKind = 'drama' | 'qa_fixture';

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
  readonly contentKind: VideoContentKind;
};
