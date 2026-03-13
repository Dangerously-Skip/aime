'use client';

import { useCallback, useRef, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

interface UseSSEStreamOptions {
  onChunk: (event: SSEEvent) => void;
  onError: (error: Error) => void;
  onDone: () => void;
}

interface UseSSEStreamReturn {
  sendMessage: (
    message: string,
    chatId: string,
    surfaceId: string,
    model: string,
    extra?: {
      personalPreferences?: string
      displayName?: string
      attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' }>
      webSearch?: boolean
      projectInstructions?: string
      projectKnowledge?: string
      apiKey?: string
    }
  ) => Promise<void>;
  isStreaming: boolean;
  abort: () => void;
}

function parseSSELines(
  buffer: string,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void
): string {
  const lines = buffer.split('\n');
  let remaining = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === lines.length - 1 && !buffer.endsWith('\n')) {
      remaining = line;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith(':')) continue;

    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') {
        onDone();
        return '';
      }
      try {
        const parsed = JSON.parse(payload);
        // Spread parsed data so all fields (content, name, id, etc.) are directly accessible
        onEvent(parsed as SSEEvent);
      } catch {
        // Skip unparseable lines
      }
    }
  }

  return remaining;
}

export function useSSEStream(options: UseSSEStreamOptions): UseSSEStreamReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (
      message: string,
      chatId: string,
      surfaceId: string,
      model: string,
      extra?: {
        personalPreferences?: string
        displayName?: string
        attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' }>
        webSearch?: boolean
        projectInstructions?: string
        projectKnowledge?: string
        apiKey?: string
      }
    ): Promise<void> => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(true);

      try {
        const response = await fetch(`/api/chat/${surfaceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            chatId,
            model,
            ...(extra?.personalPreferences ? { personalPreferences: extra.personalPreferences } : {}),
            ...(extra?.displayName ? { displayName: extra.displayName } : {}),
            ...(extra?.attachments?.length ? { attachments: extra.attachments } : {}),
            ...(extra?.webSearch ? { webSearch: true } : {}),
            ...(extra?.projectInstructions ? { projectInstructions: extra.projectInstructions } : {}),
            ...(extra?.projectKnowledge ? { projectKnowledge: extra.projectKnowledge } : {}),
            ...(extra?.apiKey ? { apiKey: extra.apiKey } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        while (!done) {
          const result = await reader.read();
          if (result.done) {
            if (buffer.trim()) {
              parseSSELines(buffer + '\n', optionsRef.current.onChunk, () => {});
            }
            done = true;
            break;
          }

          buffer += decoder.decode(result.value, { stream: true });
          buffer = parseSSELines(
            buffer,
            optionsRef.current.onChunk,
            () => { done = true; }
          );

          if (done) {
            reader.cancel();
            break;
          }
        }

        optionsRef.current.onDone();
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const err = error instanceof Error ? error : new Error(String(error));
        optionsRef.current.onError(err);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    []
  );

  return { sendMessage, isStreaming, abort };
}
