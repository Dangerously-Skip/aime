// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { VoiceScope } from '@/lib/voice/voice-scope';
import { useAppStore } from '@/stores/app-store';
import { useCodeWorkspaceStore } from '@/stores/code-workspace-store';
import { DEFAULT_WORKSPACE_LAYOUT } from '@/lib/code-workspace/types';
import { PanelToolbar } from '@/components/surfaces/code/workspace/panel-toolbar';
import { useSurfaceActive, useSurfaceKeydown } from './use-surface-active';

/**
 * Every surface is mounted at once and hidden with CSS, so a `window` keydown
 * listener in a hidden surface still fires. Code's ⌘B/⌘J/⌘E toggled panels
 * while the user typed in Chat; Browser's ⌘⇧S took screenshots from Code.
 */

beforeEach(() => {
  useAppStore.setState({ activeSurface: 'chat', sidebarMode: 'history' } as never);
});
afterEach(cleanup);

function Probe({ onKey, onActive }: { onKey: (e: KeyboardEvent) => void; onActive?: (a: boolean) => void }) {
  const active = useSurfaceActive();
  onActive?.(active);
  useSurfaceKeydown(onKey);
  return null;
}

describe('useSurfaceKeydown', () => {
  it('fires only for the surface on screen', () => {
    const chat = vi.fn();
    const code = vi.fn();
    render(
      <>
        <VoiceScope id="chat" active><Probe onKey={chat} /></VoiceScope>
        <VoiceScope id="code" active={false}><Probe onKey={code} /></VoiceScope>
      </>,
    );
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(code).not.toHaveBeenCalled();

    act(() => useAppStore.setState({ activeSurface: 'code' } as never));
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(code).toHaveBeenCalledTimes(1);
  });

  it('is inactive while Customize replaces the surface area', () => {
    const seen: boolean[] = [];
    useAppStore.setState({ sidebarMode: 'customize' } as never);
    render(<VoiceScope id="chat" active><Probe onKey={() => {}} onActive={(a) => seen.push(a)} /></VoiceScope>);
    expect(seen.at(-1)).toBe(false);
  });

  it('outside any surface scope it is active', () => {
    const fn = vi.fn();
    render(<Probe onKey={fn} />);
    fireEvent.keyDown(window, { key: 'x' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('Code panel shortcuts', () => {
  const WS = '/tmp/ws';
  const visible = () => (useCodeWorkspaceStore.getState().byWorkspace[WS] ?? DEFAULT_WORKSPACE_LAYOUT).visible;

  beforeEach(() => {
    useCodeWorkspaceStore.setState({ byWorkspace: {} } as never);
  });

  it('⌘B does not toggle the file tree while another surface is on screen', () => {
    const before = visible().tree;
    render(<VoiceScope id="code" active={false}><PanelToolbar workspace={WS} /></VoiceScope>);
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(visible().tree).toBe(before);
  });

  it('⌘B toggles the file tree when Code is on screen', () => {
    useAppStore.setState({ activeSurface: 'code' } as never);
    const before = visible().tree;
    render(<VoiceScope id="code" active><PanelToolbar workspace={WS} /></VoiceScope>);
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(visible().tree).toBe(!before);
  });

  it('⌘⇧D is no longer swallowed', () => {
    useAppStore.setState({ activeSurface: 'code' } as never);
    render(<VoiceScope id="code" active><PanelToolbar workspace={WS} /></VoiceScope>);
    const ev = new KeyboardEvent('keydown', { key: 'd', metaKey: true, shiftKey: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
