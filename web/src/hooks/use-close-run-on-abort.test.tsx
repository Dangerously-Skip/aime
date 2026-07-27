// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCloseRunOnAbort } from './use-close-run-on-abort';
import { useRunRecorder } from './use-run-recorder';
import { useRunStore } from '@/stores/run-store';
import { notifyStreamAborted } from '@/lib/stream-registry';

/**
 * The regression (DEFECT 5a): `runRecorder.succeed()` and `.fail()` are called
 * only from the stream's `onDone` / `onError`, and an aborted fetch reaches
 * neither. So pressing Stop, switching conversation, or a stuck-tool cancel left
 * the Run in `running` for ever — and a Run that never ends is exactly the thing
 * the run log exists to make impossible ("a widget that had failed forty times
 * looked identical to one that had simply never run").
 *
 * Real run store, real recorder, real abort bus — only the run-log POST is stubbed.
 */

function setup(ownsChat: (chatId: string) => boolean) {
  return renderHook(() => {
    const recorder = useRunRecorder('chat');
    useCloseRunOnAbort(recorder.finish, ownsChat);
    return recorder;
  });
}

const runOf = (id: string) => useRunStore.getState().getRun(id);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  useRunStore.setState({ runs: [], goals: [] });
});

describe('useCloseRunOnAbort', () => {
  it('closes the run as cancelled when the user stops the stream', () => {
    const { result } = setup(() => true);
    let id = '';
    act(() => {
      id = result.current.begin({ trigger: 'chat', model: 'sonnet' });
    });
    expect(runOf(id)?.status).toBe('running');

    act(() => notifyStreamAborted({ chatId: 'c1', reason: 'user' }));

    expect(runOf(id)?.status).toBe('cancelled');
    expect(runOf(id)?.endedAt).toBeTypeOf('number');
  });

  it('records a genuine inactivity timeout as a timeout, not a cancel', () => {
    // A timeout may simply need longer; a cancel was a decision. Collapsing them
    // makes "is my automation broken?" unanswerable.
    const { result } = setup(() => true);
    let id = '';
    act(() => {
      id = result.current.begin({ trigger: 'chat' });
    });

    act(() => notifyStreamAborted({ chatId: 'c1', reason: 'timeout' }));

    expect(runOf(id)?.status).toBe('timeout');
    expect(runOf(id)?.error).toBeTruthy();
  });

  it('leaves another surface’s run alone', () => {
    // Aborts are broadcast to every listener, so without an ownership test a Stop
    // in Cowork would close Chat's live run too.
    const { result } = setup((chatId) => chatId === 'mine');
    let id = '';
    act(() => {
      id = result.current.begin({ trigger: 'chat' });
    });

    act(() => notifyStreamAborted({ chatId: 'not-mine', reason: 'user' }));
    expect(runOf(id)?.status).toBe('running');

    act(() => notifyStreamAborted({ chatId: 'mine', reason: 'user' }));
    expect(runOf(id)?.status).toBe('cancelled');
  });

  it('does not invent a run when nothing is in flight', () => {
    setup(() => true);
    act(() => notifyStreamAborted({ chatId: 'c1', reason: 'user' }));
    expect(useRunStore.getState().runs).toHaveLength(0);
  });

  it('a completed run is not reopened or double-ended by a later abort', () => {
    const { result } = setup(() => true);
    let id = '';
    act(() => {
      id = result.current.begin({ trigger: 'chat' });
    });
    act(() => result.current.succeed());
    expect(runOf(id)?.status).toBe('succeeded');

    act(() => notifyStreamAborted({ chatId: 'c1', reason: 'user' }));
    expect(runOf(id)?.status).toBe('succeeded');
  });

  it('unsubscribes on unmount', () => {
    const { result, unmount } = setup(() => true);
    let id = '';
    act(() => {
      id = result.current.begin({ trigger: 'chat' });
    });
    unmount();

    act(() => notifyStreamAborted({ chatId: 'c1', reason: 'user' }));
    expect(runOf(id)?.status).toBe('running');
  });
});
