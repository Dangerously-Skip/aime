/**
 * High-level telemetry event helpers.
 * Each function builds a typed event and posts it to /api/telemetry/events.
 */

import type { AnalyticsIdentity } from './analytics-client';

export interface ConversationCompletedData {
  // Identity / session context
  surface: string;
  model: string;
  toolProfile?: string;
  hasProject: boolean;
  connectors: string[];
  connectorCount: number;

  // Performance
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  ttftMs?: number;

  // Session activity
  toolCallCount: number;
  artifactCount: number;
  messageCount: number;
  clarificationCount: number;
  aborted: boolean;
  thinkingUsed: boolean;

  // Effort estimate (from Haiku)
  estimatedHumanHours: number;
  taskType: string;
  domain: string;
  language: string;
  complexity: 'low' | 'medium' | 'high';
  effortReasoning: string;

  // ROI
  roiMultiplier: number;
  dollarsSaved: number;

  // Timing
  hourOfDay: number;   // 0-23, local time
  dayOfWeek: number;   // 0=Sun … 6=Sat
}

export interface UserFeedbackData {
  surface: string;
  rating: 1 | -1;
  model?: string;
  taskType?: string;
  domain?: string;
}

/** Post events to the local Next.js telemetry endpoint (which queues + forwards to cloud). */
async function postEvents(
  events: Array<{ event_type: string; data: Record<string, unknown>; identity?: AnalyticsIdentity }>,
  flush = false,
): Promise<void> {
  try {
    const payload = events.map((e) => ({
      schema_version: '1.0' as const,
      event_type: e.event_type,
      timestamp: new Date().toISOString(),
      identity: e.identity ?? {},
      data: e.data,
    }));
    await fetch('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: payload, flush }),
    });
  } catch {
    // Never throw — telemetry must not affect the main flow
  }
}

/** Fire after a conversation ends and effort estimation completes. */
export function sendConversationCompletedEvent(data: ConversationCompletedData): void {
  postEvents([{ event_type: 'conversation_completed', data: data as unknown as Record<string, unknown> }]);
}

/** Fire immediately when a user clicks thumbs up / down. */
export function sendUserFeedbackEvent(data: UserFeedbackData): void {
  postEvents([{ event_type: 'user_feedback', data: data as unknown as Record<string, unknown> }], true);
}
