'use client';

import { useState, useCallback, useRef } from 'react';
import type { AttachmentFile } from '@/components/shared/attachment-menu';

export interface FileSuggestion {
  path: string;
  name: string;
  relative: string;
}

/** Returns the partial @query at end of input (text after last @), or null. */
export function getAtQuery(input: string): string | null {
  const match = input.match(/@([^\s@]*)$/);
  return match ? match[1] : null;
}

/** Remove the trailing @partial from an input string. */
export function removeAtQuery(input: string): string {
  return input.replace(/@([^\s@]*)$/, '');
}

interface UseAtSuggestionsResult {
  fileSuggestions: FileSuggestion[];
  atLoading: boolean;
  fetchAtSuggestions: (query: string, cwd: string) => void;
  clearAtSuggestions: () => void;
  resolveFileAsAttachment: (filePath: string) => Promise<AttachmentFile | null>;
}

export function useAtSuggestions(): UseAtSuggestionsResult {
  const [fileSuggestions, setFileSuggestions] = useState<FileSuggestion[]>([]);
  const [atLoading, setAtLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAtSuggestions = useCallback((query: string, cwd: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!cwd) {
      setFileSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setAtLoading(true);
      try {
        const res = await fetch(
          `/api/files/search?q=${encodeURIComponent(query)}&cwd=${encodeURIComponent(cwd)}&limit=15`,
        );
        if (res.ok) {
          const data = (await res.json()) as { files: FileSuggestion[] };
          setFileSuggestions(data.files ?? []);
        }
      } catch {
        setFileSuggestions([]);
      } finally {
        setAtLoading(false);
      }
    }, 150);
  }, []);

  const clearAtSuggestions = useCallback(() => {
    setFileSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const resolveFileAsAttachment = useCallback(
    async (filePath: string): Promise<AttachmentFile | null> => {
      try {
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) return null;
        const data = (await res.json()) as { content: string; name: string };
        return {
          name: data.name,
          content: data.content,
          type: 'text/plain',
          category: 'text',
        };
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    fileSuggestions,
    atLoading,
    fetchAtSuggestions,
    clearAtSuggestions,
    resolveFileAsAttachment,
  };
}
