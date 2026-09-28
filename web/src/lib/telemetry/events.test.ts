import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendUserFeedbackEvent, __resetTelemetryClientForTests } from './events';

/**
 * The renderer stops posting once the server says telemetry is off — it cannot
 * turn on without a restart, so every later request would be wasted.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  __resetTelemetryClientForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const feedback = { conversationId: 'c', messageId: 'm', rating: 'up' } as unknown as Parameters<
  typeof sendUserFeedbackEvent
>[0];

describe('telemetry client', () => {
  it('stops posting after the server reports telemetry disabled', async () => {
    fetchMock.mockResolvedValue(Response.json({ queued: 0, enabled: false }));
    sendUserFeedbackEvent(feedback);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // let the response body be read
    await new Promise((r) => setTimeout(r, 0));
    sendUserFeedbackEvent(feedback);
    sendUserFeedbackEvent(feedback);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps posting while the server accepts events', async () => {
    fetchMock.mockImplementation(async () => Response.json({ queued: 1, enabled: true }));
    sendUserFeedbackEvent(feedback);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    sendUserFeedbackEvent(feedback);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.events[0].identity.app).toBe('aime');
  });
});
