import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './app-store';

describe('app-store — settings deep link', () => {
  beforeEach(() => useAppStore.setState({ settingsOpen: false, settingsSection: 'profile' }));

  it('openSettings(section) opens the dialog on that section', () => {
    useAppStore.getState().openSettings('connectors');
    expect(useAppStore.getState().settingsOpen).toBe(true);
    expect(useAppStore.getState().settingsSection).toBe('connectors');
  });

  it('openSettings() keeps the last section', () => {
    useAppStore.getState().setSettingsSection('memory');
    useAppStore.getState().openSettings();
    expect(useAppStore.getState().settingsSection).toBe('memory');
  });

  it('does not persist the section', () => {
    const opts = useAppStore.persist.getOptions();
    const persisted = opts.partialize!(useAppStore.getState()) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('settingsSection');
  });
});
