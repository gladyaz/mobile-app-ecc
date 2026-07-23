import { Platform } from 'react-native';

import { getTokens } from '@/services/auth/token-store';
import {
  AnalyticsEventInput,
  postAnalyticsEvents,
} from '@/services/analytics/analytics-service';

/**
 * Phase 11, work unit 11-M2: a deliberately lightweight, in-memory,
 * fire-and-forget event queue — NOT a clone of Phase 9's persisted
 * per-user-action sync queue. That machinery exists because likes/saves/
 * progress are user data whose loss is a real bug; analytics events are
 * telemetry, and losing a batch on app close or network failure is an
 * accepted, recorded design property (control workspace DECISIONS.md,
 * "Phase 11 approved..."). No persistence, no retries, no ordering
 * guarantees — events buffer in memory and flush in batches, and any
 * failure drops the batch silently, because analytics must never break or
 * block UX.
 *
 * Plain module (no React) for the same reason as `token-store.ts`: call
 * sites include non-React code paths (global error handlers) and
 * identity-stable component callbacks that must not take new dependencies.
 */

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_THRESHOLD = 20;
/** Mirrors the backend's per-request batch cap. */
const MAX_BUFFER_SIZE = 50;

let buffer: AnalyticsEventInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;

function resolvePlatform(): string {
  return Platform.OS === 'ios' || Platform.OS === 'android'
    ? Platform.OS
    : 'web';
}

/**
 * Enqueues an event. Silently a no-op while logged out: the backend
 * requires a JWT for ingestion (recorded decision), so buffering guest
 * events would only build a queue that can never legitimately flush.
 */
export function trackEvent(
  eventName: string,
  properties?: Record<string, string | number | boolean>
): void {
  if (!getTokens()) {
    return;
  }

  buffer.push({
    eventName,
    ...(properties ? { properties } : {}),
    clientTimestamp: new Date().toISOString(),
    platform: resolvePlatform(),
  });

  if (buffer.length > MAX_BUFFER_SIZE) {
    // Oldest events are the least valuable; keep the newest.
    buffer = buffer.slice(-MAX_BUFFER_SIZE);
  }

  if (buffer.length >= FLUSH_BATCH_THRESHOLD) {
    void flushAnalyticsQueue();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushAnalyticsQueue();
    }, FLUSH_INTERVAL_MS);
  }
}

/** Flushes the buffer now. Failures drop the batch silently, by design. */
export async function flushAnalyticsQueue(): Promise<void> {
  if (isFlushing || buffer.length === 0 || !getTokens()) {
    return;
  }

  isFlushing = true;
  const batch = buffer;
  buffer = [];

  try {
    await postAnalyticsEvents(batch);
  } catch {
    // Dropped, deliberately: no retry queue for telemetry.
  } finally {
    isFlushing = false;
  }
}

export function __resetAnalyticsQueueForTests(): void {
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  isFlushing = false;
}
