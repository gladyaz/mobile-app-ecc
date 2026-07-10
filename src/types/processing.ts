export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'needs_review';

export type ProcessingJob = {
  readonly id: string;
  readonly videoId: string;
  readonly title: string;
  readonly episodeNumber: number;
  readonly fileName: string;
  readonly status: ProcessingStatus;
  readonly progress: number;
  readonly subtitleLanguage: string;
  readonly sourceLanguage: string;
  readonly estimatedTime: string;
  readonly processedAt: string | null;
  readonly errorMessage?: string;
};

export type ProcessingSummary = {
  readonly total: number;
  readonly completed: number;
  readonly processing: number;
  readonly failed: number;
  readonly needsReview: number;
};

export type UploadedVideo = {
  readonly id: string;
  readonly videoId: string;
  readonly title: string;
  readonly episodeNumber: number;
  readonly fileName: string;
  readonly status: ProcessingStatus;
};
