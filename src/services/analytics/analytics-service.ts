import { request } from '@/services/api/client';

/**
 * Mirrors the backend's analytics ingestion contract exactly (Phase 11,
 * `POST /analytics/events` — see short-drama-backend
 * `src/analytics/analytics.types.ts` for the event-name/property
 * allowlist, which the server enforces regardless of what is sent here).
 */
export type AnalyticsEventInput = {
  readonly eventName: string;
  readonly properties?: Record<string, string | number | boolean>;
  readonly clientTimestamp: string;
  readonly platform: string;
};

export type IngestEventsResponse = {
  readonly accepted: number;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Posts a batch of analytics events. Requires auth (the backend rejects
 * anonymous ingestion by recorded decision). Callers are expected to treat
 * failures as non-fatal — analytics must never break UX — which is the
 * queue's job (`analytics-queue.ts`), not this thin service layer's.
 */
export async function postAnalyticsEvents(
  events: readonly AnalyticsEventInput[]
): Promise<IngestEventsResponse> {
  return request<IngestEventsResponse>(
    'analytics/events',
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ events }),
    },
    { requiresAuth: true }
  );
}
