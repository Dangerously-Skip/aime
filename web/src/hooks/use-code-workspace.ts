'use client';

import { useCallback } from 'react';
import { useCodeWorkspaceStore } from '@/stores/code-workspace-store';
import { DEFAULT_WORKSPACE_LAYOUT, type PanelSlot, type WorkspaceTab } from '@/lib/code-workspace/types';

/**
 * Hook the workspace layout for a specific folder. Returns layout + actions
 * pre-bound to the current workspace path. Components don't need to thread
 * the workspace string through every call.
 */
export function useCodeWorkspace(workspace: string | null) {
  const key = workspace ?? '__no_workspace__';
  const layout = useCodeWorkspaceStore((s) => s.byWorkspace[key] ?? DEFAULT_WORKSPACE_LAYOUT);
  const _setVisible = useCodeWorkspaceStore((s) => s.setVisible);
  const _togglePanel = useCodeWorkspaceStore((s) => s.togglePanel);
  const _setSize = useCodeWorkspaceStore((s) => s.setSize);
  const _assignSlot = useCodeWorkspaceStore((s) => s.assignSlot);
  const _openTab = useCodeWorkspaceStore((s) => s.openTab);
  const _closeTab = useCodeWorkspaceStore((s) => s.closeTab);
  const _setActiveTab = useCodeWorkspaceStore((s) => s.setActiveTab);
  const _pinTab = useCodeWorkspaceStore((s) => s.pinTab);
  const _resetLayout = useCodeWorkspaceStore((s) => s.resetLayout);

  const setVisible = useCallback(
    (slot: PanelSlot, visible: boolean) => _setVisible(key, slot, visible),
    [key, _setVisible],
  );
  const togglePanel = useCallback((slot: PanelSlot) => _togglePanel(key, slot), [key, _togglePanel]);
  const setSize = useCallback(
    (size: 'chatWidth' | 'leftWidth' | 'rightWidth' | 'terminalHeight', value: number) =>
      _setSize(key, size, value),
    [key, _setSize],
  );
  const assignSlot = useCallback(
    (slot: PanelSlot, region: 'left' | 'center-top' | 'center-bottom' | 'right' | 'top') =>
      _assignSlot(key, slot, region),
    [key, _assignSlot],
  );
  const openTab = useCallback((tab: WorkspaceTab) => _openTab(key, tab), [key, _openTab]);
  const closeTab = useCallback((tabId: string) => _closeTab(key, tabId), [key, _closeTab]);
  const setActiveTab = useCallback(
    (tabId: string | null) => _setActiveTab(key, tabId),
    [key, _setActiveTab],
  );
  const pinTab = useCallback((tabId: string) => _pinTab(key, tabId), [key, _pinTab]);
  const resetLayout = useCallback(() => _resetLayout(key), [key, _resetLayout]);

  return {
    layout,
    activeTab: layout.openTabs.find((t) => t.id === layout.activeTabId) ?? null,
    setVisible,
    togglePanel,
    setSize,
    assignSlot,
    openTab,
    closeTab,
    setActiveTab,
    pinTab,
    resetLayout,
  };
}
