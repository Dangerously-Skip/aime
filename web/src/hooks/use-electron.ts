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
  openAuthWindow: (url: string) => Promise<void>;
  onGithubAuthResult: (callback: (data: unknown) => void) => void;
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
  openAuthWindow: (url: string) => Promise<void>;
}

export function useElectron(): UseElectronReturn {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
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

  const openAuthWindow = useCallback(async (url: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.openAuthWindow(url);
    }
  }, []);

  return { isElectron, selectFolder, getUserName, openAuthWindow };
}
