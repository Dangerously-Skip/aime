'use client';

import { useMemo } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useMemoryStore } from '@/stores/memory-store';
import { formatMemoriesForPrompt } from '@/lib/memory/retriever';
import { useDeckTheme } from '@/hooks/use-deck-theme';
import { useSearchSettings } from '@/hooks/use-search-settings';
import type { SendExtra } from '@/hooks/use-sse-stream';

/**
 * The half of a turn's request that describes the USER rather than the message.
 *
 * Every surface built this object by hand and each one fell behind the others
 * in its own way: Chat sent no deck theme or search settings (every deck came
 * back unstyled and search resolved to `none`), Cowork's auto-continue dropped
 * eight fields, Code sent no personal preferences or project instructions, and
 * Browser sent none of it. Built once, a field added here reaches every surface.
 */

interface ProjectFields {
  projectInstructions?: string | null;
  projectKnowledge?: string | null;
  crossSurfaceContext?: string | null;
}

export type TurnSettings = Pick<
  SendExtra,
  | 'personalPreferences'
  | 'displayName'
  | 'securitySettings'
  | 'searchSettings'
  | 'deckTheme'
  | 'projectInstructions'
  | 'projectKnowledge'
  | 'crossSurfaceContext'
>;

export function useTurnSettings(chatId: string, project: ProjectFields = {}): TurnSettings {
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const displayName = useSettingsStore((s) => s.displayName);
  const blockDangerousCommands = useSettingsStore((s) => s.blockDangerousCommands);
  const blockNetworkCommands = useSettingsStore((s) => s.blockNetworkCommands);
  const restrictToProjectFolder = useSettingsStore((s) => s.restrictToProjectFolder);
  const disableBashTool = useSettingsStore((s) => s.disableBashTool);
  const searchSettings = useSearchSettings();
  const deckTheme = useDeckTheme(chatId);
  const { projectInstructions, projectKnowledge, crossSurfaceContext } = project;

  return useMemo(
    () => ({
      personalPreferences: personalPreferences || undefined,
      displayName: displayName || undefined,
      projectInstructions: projectInstructions || undefined,
      projectKnowledge: projectKnowledge || undefined,
      crossSurfaceContext: crossSurfaceContext || undefined,
      securitySettings: {
        blockDangerousCommands,
        blockNetworkCommands,
        restrictToProjectFolder,
        disableBashTool,
      },
      searchSettings,
      deckTheme,
    }),
    [
      personalPreferences,
      displayName,
      projectInstructions,
      projectKnowledge,
      crossSurfaceContext,
      blockDangerousCommands,
      blockNetworkCommands,
      restrictToProjectFolder,
      disableBashTool,
      searchSettings,
      deckTheme,
    ],
  );
}

/** The memories relevant to a message, marked as used. Undefined when there are none. */
export function memoriesFor(query: string, projectId: string | null | undefined): string | undefined {
  const memory = useMemoryStore.getState();
  const relevant = memory.getMemoriesForContext({ projectId: projectId ?? null, query });
  relevant.forEach((m) => memory.touchMemory(m.id));
  return formatMemoriesForPrompt(relevant) || undefined;
}

/**
 * The urgent context-bus events addressed to a surface, consumed as they are
 * read so the next turn does not repeat them. Undefined when there are none.
 */
export async function drainContextBus(surface: string): Promise<SendExtra['contextBusEvents']> {
  const { useContextBusStore } = await import('@/stores/context-bus-store');
  const bus = useContextBusStore.getState();
  const events = bus
    .getUnconsumed(surface)
    .filter((e) => e.priority === 'p0' || e.priority === 'p1')
    .map((e) => ({ summary: e.summary, source: e.source, priority: e.priority }));
  if (events.length === 0) return undefined;
  bus.consumeAll(surface);
  return events;
}
