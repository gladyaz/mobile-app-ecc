import { mockProcessingJobs } from '@/data/mock-processing-jobs';
import type { ProcessingJob, ProcessingSummary, UploadedVideo } from '@/types/processing';

export function getProcessingJobs(): readonly ProcessingJob[] {
  // Future backend integration will fetch processing history from the processing API.
  return mockProcessingJobs;
}

export function getProcessingSummary(): ProcessingSummary {
  // Future backend integration can return this summary precomputed by the backend.
  return mockProcessingJobs.reduce<ProcessingSummary>(
    (summary, job) => ({
      total: summary.total + 1,
      completed: summary.completed + (job.status === 'completed' ? 1 : 0),
      processing: summary.processing + (job.status === 'processing' ? 1 : 0),
      failed: summary.failed + (job.status === 'failed' ? 1 : 0),
      needsReview: summary.needsReview + (job.status === 'needs_review' ? 1 : 0),
    }),
    {
      total: 0,
      completed: 0,
      processing: 0,
      failed: 0,
      needsReview: 0,
    }
  );
}

export function getUploadedVideos(): readonly UploadedVideo[] {
  // Future backend integration will fetch uploaded videos for the authenticated user.
  return mockProcessingJobs.map((job) => ({
    id: `upload_${job.id}`,
    videoId: job.videoId,
    title: job.title,
    episodeNumber: job.episodeNumber,
    fileName: job.fileName,
    status: job.status,
  }));
}
