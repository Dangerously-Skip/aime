import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './app-store';

beforeEach(() => {
  useAppStore.setState({
    activeSurface: 'chat',
    sidebarVisible: true,
    theme: 'light',
    settingsOpen: false,
    sidebarMode: 'history',
    viewingProjectId: null,
    customizeSection: 'landing',
    selectedSkillId: null,
    selectedConnectorId: null,
    selectedAgentName: null,
    heartbeatPanelOpen: false,
  });
});

const store = () => useAppStore.getState();

describe('app store', () => {
  it('switches surfaces and toggles the sidebar', () => {
    store().setActiveSurface('cowork');
    expect(store().activeSurface).toBe('cowork');

    store().toggleSidebar();
    expect(store().sidebarVisible).toBe(false);
    store().toggleSidebar();
    expect(store().sidebarVisible).toBe(true);
  });

  it('navigateToProject switches sidebar mode and sets the project', () => {
    store().navigateToProject('proj1');
    expect(store().sidebarMode).toBe('projects');
    expect(store().viewingProjectId).toBe('proj1');
  });

  it('changing customize section clears item selections', () => {
    store().setSelectedSkillId('skill1');
    store().setSelectedConnectorId('github');
    store().setSelectedAgentName('researcher');

    store().setCustomizeSection('connectors');
    expect(store().customizeSection).toBe('connectors');
    expect(store().selectedSkillId).toBeNull();
    expect(store().selectedConnectorId).toBeNull();
    expect(store().selectedAgentName).toBeNull();
  });
});
