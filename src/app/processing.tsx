import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
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
  pending: Palette.textSecondary,
  processing: Palette.primary,
  completed: Palette.success,
  failed: Palette.error,
  needs_review: Palette.warning,
};

type StatusFilter = 'all' | ProcessingStatus;

const filterOptions: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'completed', label: 'Completed' },
  { key: 'processing', label: 'Processing' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
  { key: 'needs_review', label: 'Needs Review' },
];

export default function ProcessingHistoryScreen() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const summary = getProcessingSummary();
  const processingJobs = getProcessingJobs();
  const uploadedVideos = getUploadedVideos();
  const pendingCount =
    summary.total - summary.completed - summary.processing - summary.failed - summary.needsReview;
  const filteredJobs = useMemo(
    () =>
      statusFilter === 'all'
        ? processingJobs
        : processingJobs.filter((job) => job.status === statusFilter),
    [processingJobs, statusFilter]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Kembali"
          accessibilityRole="button"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }

            router.replace('/profile');
          }}
          style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
            size={18}
            tintColor={Palette.text}
          />
        </Pressable>
        <View>
          <Text style={styles.title}>Processing History</Text>
          <Text style={styles.internalLabel}>INTERNAL · STAFF ONLY</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ScrollView
          horizontal
          contentContainerStyle={styles.statRow}
          showsHorizontalScrollIndicator={false}>
          <SummaryCard label="Total" value={summary.total} valueColor={Palette.text} />
          <SummaryCard label="Completed" value={summary.completed} valueColor={Palette.success} />
          <SummaryCard label="Processing" value={summary.processing} valueColor={Palette.primary} />
          <SummaryCard label="Pending" value={pendingCount} valueColor={Palette.textSecondary} />
          <SummaryCard label="Failed" value={summary.failed} valueColor={Palette.error} />
          <SummaryCard label="Needs Review" value={summary.needsReview} valueColor={Palette.warning} />
        </ScrollView>

        <ScrollView
          horizontal
          contentContainerStyle={styles.filterRow}
          showsHorizontalScrollIndicator={false}>
          {filterOptions.map((option) => {
            const isSelected = statusFilter === option.key;

            return (
              <Pressable
                accessibilityRole="button"
                key={option.key}
                onPress={() => setStatusFilter(option.key)}
                style={({ pressed }) => [
                  styles.filterChip,
                  isSelected && styles.filterChipSelected,
                  pressed && styles.buttonPressed,
                ]}>
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.list}>
          {filteredJobs.map((job) => (
            <ProcessingJobCard job={job} key={job.id} />
          ))}
        </View>

        <Text style={styles.sectionTitle}>Uploaded Videos</Text>
        <View style={styles.list}>
          {uploadedVideos.map((video) => (
            <UploadedVideoCard key={video.id} video={video} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

type SummaryCardProps = {
  readonly label: string;
  readonly value: number;
  readonly valueColor: string;
};

function SummaryCard({ label, value, valueColor }: SummaryCardProps) {
  return (
    <View style={styles.summaryCard}>
      <Text style={[styles.summaryValue, { color: valueColor }]}>{value}</Text>
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
        <Text style={styles.cardTitle}>{job.title}</Text>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}1f` }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabels[job.status]}</Text>
        </View>
      </View>

      <Text style={styles.metaText}>
        EP {job.episodeNumber} · {job.fileName}
      </Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${job.progress}%`, backgroundColor: statusColor }]} />
      </View>
      <Text style={styles.progressLabel}>
        {job.status === 'pending' ? 'Dalam antrian' : `${job.progress}%`}
      </Text>

      {job.errorMessage ? (
        <View style={styles.errorBox}>
          <SymbolView
            name={{ ios: 'exclamationmark.circle', android: 'error_outline', web: 'error_outline' }}
            size={14}
            tintColor={Palette.error}
          />
          <Text style={styles.errorText}>{job.errorMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

type UploadedVideoCardProps = {
  readonly video: UploadedVideo;
};

function UploadedVideoCard({ video }: UploadedVideoCardProps) {
  return (
    <View style={styles.uploadCard}>
      <View style={styles.uploadInfo}>
        <Text style={styles.uploadTitle}>{video.title}</Text>
        <Text style={styles.metaText}>
          EP {video.episodeNumber} · {video.fileName}
        </Text>
      </View>
      <View style={[styles.statusBadge, { backgroundColor: `${statusColors[video.status]}1f` }]}>
        <Text style={[styles.statusText, { color: statusColors[video.status] }]}>
          {statusLabels[video.status]}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  title: {
    fontSize: 18,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  internalLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  statRow: {
    gap: 10,
    paddingVertical: 8,
  },
  summaryCard: {
    minWidth: 92,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.lg,
    backgroundColor: Palette.surface,
  },
  summaryValue: {
    fontSize: 21,
    fontFamily: FontFamily.extraBold,
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 10.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  filterRow: {
    gap: 8,
    paddingVertical: 12,
  },
  filterChip: {
    height: 34,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  filterChipSelected: {
    borderColor: Palette.primary,
    backgroundColor: Palette.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  filterChipTextSelected: {
    color: Palette.text,
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  list: {
    gap: 12,
  },
  card: {
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 18,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  statusText: {
    fontSize: 10.5,
    fontFamily: FontFamily.bold,
  },
  metaText: {
    marginTop: 4,
    fontSize: 11.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textMuted,
  },
  progressTrack: {
    height: 6,
    marginTop: 12,
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Palette.border,
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  progressLabel: {
    marginTop: 6,
    fontSize: 10.5,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
    textAlign: 'right',
  },
  errorBox: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: Radius.md,
    backgroundColor: 'rgba(239, 68, 68, 0.09)',
  },
  errorText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: FontFamily.regular,
    color: '#F87171',
  },
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  uploadInfo: {
    flex: 1,
    minWidth: 0,
  },
  uploadTitle: {
    fontSize: 13.5,
    lineHeight: 18,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
