'use client';

import { useCallback, useEffect, useState } from 'react';

interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  getUserName: () => Promise<string>;
  openPath: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<{ success: boolean; path: string }>;
  saveFileDialog: (defaultName: string, filters?: { name: string; extensions: string[] }[]) => Promise<string | null>;
  ensureDir: (dirPath: string) => Promise<{ success: boolean }>;
  fileExists: (filePath: string) => Promise<boolean>;
  getHomeDir: () => Promise<string>;
  showNotification: (title: string, body: string) => Promise<void>;
  openAuthWindow: (url: string) => Promise<void>;
  openConnectorAuthWindow: (url: string, callbackPath: string) => Promise<{ code: string | null; state: string | null; error: string | null }>;
  onGithubAuthResult: (callback: (data: unknown) => void) => void;
  detectEditors: () => Promise<{ id: string; name: string; command: string }[]>;
  openInEditor: (editorId: string, folderPath: string) => Promise<void>;
  onUpdateState: (callback: (data: { state: "idle" | "checking" | "available" | "downloading" | "ready" | "error"; statusLabel: string | null }) => void) => void;
  getAppVersion: () => string;
  getPlatform: () => string;
  getHostname: () => string;
  checkForUpdates: () => void;
  installUpdate: () => void;
  onOpenSettings: (callback: () => void) => void;
  /** Subscribes to the minute heartbeat. Returns an unsubscribe function (older preloads returned void). */
  onMinuteTick?: (callback: (ts: number) => void) => (() => void) | void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

interface UseElectronReturn {
  isElectron: boolean;
  selectFolder: () => Promise<string | null>;
  getUserName: () => Promise<string>;
  showNotification: (title: string, body: string) => void;
  openAuthWindow: (url: string) => Promise<void>;
}

export function useElectron(): UseElectronReturn {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    // Must run after mount: window.electronAPI is injected by the preload and
    // is absent during SSR, so reading it during render would hydrate-mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(typeof window !== 'undefined' && !!window.electronAPI);
  }, []);

  const selectFolder = useCallback(async (): Promise<string | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.selectFolder();
    }
    return null;
  }, []);

  const getUserName = useCallback(async (): Promise<string> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.getUserName();
    }
    return 'user';
  }, []);

  const showNotification = useCallback((title: string, body: string): void => {
    if (typeof window === 'undefined') return;
    if (window.electronAPI?.showNotification) {
      window.electronAPI.showNotification(title, body);
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(title, { body });
      });
    }
  }, []);

  const openAuthWindow = useCallback(async (url: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.openAuthWindow(url);
    }
  }, []);

  return { isElectron, selectFolder, getUserName, showNotification, openAuthWindow };
}
