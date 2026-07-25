'use client';

import { useMemo } from 'react';
import { useConversationStore, type Conversation } from '@/stores/conversation-store';

export interface ConversationGroup {
  label: string;
  conversations: Conversation[];
}

interface UseConversationsReturn {
  groups: ConversationGroup[];
  backgroundConversations: Conversation[];
  activeConversation: Conversation | undefined;
}

function getStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getTimePeriodLabel(timestamp: number, now: Date): string {
  const date = new Date(timestamp);
  const today = getStartOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const startOfWeek = new Date(today);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  if (date >= today) {
    return 'Today';
  }
  if (date >= yesterday) {
    return 'Yesterday';
  }
  if (date >= startOfWeek) {
    return 'This Week';
  }
  if (date >= startOfMonth) {
    return 'This Month';
  }
  return 'Older';
}

const PERIOD_ORDER: Record<string, number> = {
  'Today': 0,
  'Yesterday': 1,
  'This Week': 2,
  'This Month': 3,
  'Older': 4,
};

export function useConversations(surface: string, projectId?: string | null): UseConversationsReturn {
  const conversations = useConversationStore((state) => state.conversations);
  const activeId = useConversationStore((state) => state.activeId);

  const backgroundConversations = useMemo(() => {
    return conversations
      .filter((c) => c.surface === surface && c.isBackground)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [conversations, surface]);

  const groups = useMemo(() => {
    const now = new Date();
    // Exclude background runs from the main list
    let filtered = conversations.filter((c) => c.surface === surface && !c.isBackground);

    // Filter by project if specified
    if (projectId !== undefined && projectId !== null) {
      filtered = filtered.filter((c) => c.projectId === projectId);
    }

    // Sort by updatedAt descending (most recent first)
    const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);

    // Group by time period
    const groupMap = new Map<string, Conversation[]>();

    for (const conversation of sorted) {
      const label = getTimePeriodLabel(conversation.updatedAt, now);
      const group = groupMap.get(label);
      if (group) {
        group.push(conversation);
      } else {
        groupMap.set(label, [conversation]);
      }
    }

    // Convert to array and sort groups by period order
    const result: ConversationGroup[] = [];
    for (const [label, convos] of groupMap) {
      result.push({ label, conversations: convos });
    }

    result.sort(
      (a, b) => (PERIOD_ORDER[a.label] ?? 5) - (PERIOD_ORDER[b.label] ?? 5)
    );

    return result;
    // projectId is read above to filter the list, so it must be a dep —
    // without it, switching project reused the previous project's grouping.
  }, [conversations, surface, projectId]);

  const activeConversation = useMemo(
    () => (activeId ? conversations.find((c) => c.id === activeId) : undefined),
    [conversations, activeId]
  );

  return { groups, backgroundConversations, activeConversation };
}
