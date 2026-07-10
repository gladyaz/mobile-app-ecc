import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  getProcessingJobs,
  getProcessingSummary,
  getUploadedVideos,
} from '@/services/processing/processing-service';
import type { ProcessingJob, ProcessingStatus, UploadedVideo } from '@/types/processing';

const statusLabels: Record<ProcessingStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  needs_review: 'Needs Review',
};

const statusColors: Record<ProcessingStatus, string> = {
  pending: '#6b7280',
  processing: '#2563eb',
  completed: '#15803d',
  failed: '#b91c1c',
  needs_review: '#b45309',
};

export default function ProcessingHistoryScreen() {
  const summary = getProcessingSummary();
  const processingJobs = getProcessingJobs();
  const uploadedVideos = getUploadedVideos();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }

          router.replace('/profile');
        }}
        style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}>
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Processing History</Text>
      <Text style={styles.description}>
        Track uploaded dramas as Indonesian subtitles are prepared for review.
      </Text>

      <View style={styles.summaryGrid}>
        <SummaryCard label="Total" value={summary.total} />
        <SummaryCard label="Completed" value={summary.completed} />
        <SummaryCard label="Processing" value={summary.processing} />
        <SummaryCard label="Failed" value={summary.failed} />
        <SummaryCard label="Needs Review" value={summary.needsReview} />
      </View>

      <Text style={styles.sectionTitle}>Processing Jobs</Text>
      <View style={styles.list}>
        {processingJobs.map((job) => (
          <ProcessingJobCard key={job.id} job={job} />
        ))}
      </View>

      <Text style={styles.sectionTitle}>Uploaded Videos</Text>
      <View style={styles.list}>
        {uploadedVideos.map((video) => (
          <UploadedVideoCard key={video.id} video={video} />
        ))}
      </View>
    </ScrollView>
  );
}

type SummaryCardProps = {
  readonly label: string;
  readonly value: number;
};

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

type ProcessingJobCardProps = {
  readonly job: ProcessingJob;
};

function ProcessingJobCard({ job }: ProcessingJobCardProps) {
  const statusColor = statusColors[job.status];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleGroup}>
          <Text style={styles.episode}>Episode {job.episodeNumber}</Text>
          <Text style={styles.cardTitle}>{job.title}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>{statusLabels[job.status]}</Text>
        </View>
      </View>

      <Text style={styles.fileName}>{job.fileName}</Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${job.progress}%` }]} />
      </View>
      <Text style={styles.metaText}>{job.progress}% complete</Text>

      <View style={styles.metaGrid}>
        <Text style={styles.metaText}>Source: {job.sourceLanguage}</Text>
        <Text style={styles.metaText}>Subtitle: {job.subtitleLanguage}</Text>
        <Text style={styles.metaText}>ETA: {job.estimatedTime}</Text>
        <Text style={styles.metaText}>
          Processed: {job.processedAt ? new Date(job.processedAt).toLocaleDateString() : 'Not yet'}
        </Text>
      </View>

      {job.errorMessage ? <Text style={styles.errorText}>{job.errorMessage}</Text> : null}
    </View>
  );
}

type UploadedVideoCardProps = {
  readonly video: UploadedVideo;
};

function UploadedVideoCard({ video }: UploadedVideoCardProps) {
  return (
    <View style={styles.uploadCard}>
      <View>
        <Text style={styles.episode}>Episode {video.episodeNumber}</Text>
        <Text style={styles.uploadTitle}>{video.title}</Text>
        <Text style={styles.fileName}>{video.fileName}</Text>
      </View>
      <Text style={[styles.uploadStatus, { color: statusColors[video.status] }]}>
        {statusLabels[video.status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 18,
    paddingVertical: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#d11f3f',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
  },
  description: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 24,
    color: '#4b5563',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 22,
  },
  summaryCard: {
    minWidth: 104,
    flexGrow: 1,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
  },
  sectionTitle: {
    marginTop: 28,
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  list: {
    gap: 12,
    marginTop: 12,
  },
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitleGroup: {
    flex: 1,
  },
  episode: {
    fontSize: 13,
    fontWeight: '800',
    color: '#d11f3f',
  },
  cardTitle: {
    marginTop: 4,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
    color: '#111827',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  fileName: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: '#4b5563',
  },
  progressTrack: {
    height: 8,
    marginTop: 14,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#d11f3f',
  },
  metaGrid: {
    gap: 4,
    marginTop: 10,
  },
  metaText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#4b5563',
  },
  errorText: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 19,
    color: '#991b1b',
    backgroundColor: '#fee2e2',
  },
  uploadCard: {
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  uploadTitle: {
    marginTop: 4,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '800',
    color: '#111827',
  },
  uploadStatus: {
    fontSize: 13,
    fontWeight: '800',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
