// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireAttendedJob } from './schedulers';
import { useAppStore } from '@/stores/app-store';
import { useContextBusStore } from '@/stores/context-bus-store';
import { useAssistantStore } from '@/stores/assistant-store';
import { useSettingsStore } from '@/stores/settings-store';

const notify = vi.fn();

beforeEach(() => {
  notify.mockReset();
  (window as unknown as { electronAPI: unknown }).electronAPI = { showNotification: notify };
  useAppStore.setState({ activeSurface: 'code' } as never);
  useContextBusStore.setState({ events: [] } as never);
  useAssistantStore.setState({ activity: [] });
  useSettingsStore.setState({ quietHours: null });
});
afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('a due attended job', () => {
  it('does NOT switch the active surface — it runs in the background and says so', () => {
    fireAttendedJob({ id: 'j1', prompt: 'Weekly summary', surfaceId: 'chat', projectId: 'p1' });
    expect(useAppStore.getState().activeSurface).toBe('code');
    expect(notify).toHaveBeenCalledWith('Scheduled job started in Chat', 'Weekly summary');
    expect(useAssistantStore.getState().activity[0]).toMatchObject({
      type: 'order-fired',
      orderId: 'j1',
      label: 'Ran in Chat: Weekly summary',
    });
  });

  it('carries its project to the surface that runs it', () => {
    fireAttendedJob({ id: 'j1', prompt: 'Weekly summary', surfaceId: 'chat', projectId: 'p1' });
    expect(useContextBusStore.getState().events[0]).toMatchObject({
      targetSurface: 'chat',
      payload: { prompt: 'Weekly summary', cronJobId: 'j1', projectId: 'p1' },
    });
  });

  it('does not notify when the job runs on the surface you are looking at', () => {
    useAppStore.setState({ activeSurface: 'chat' } as never);
    fireAttendedJob({ id: 'j1', prompt: 'x', surfaceId: 'chat' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('respects quiet hours', () => {
    useSettingsStore.setState({ quietHours: { fromHour: 3, toHour: 3 } }); // always quiet
    fireAttendedJob({ id: 'j1', prompt: 'x', surfaceId: 'chat' });
    expect(notify).not.toHaveBeenCalled();
  });
});
