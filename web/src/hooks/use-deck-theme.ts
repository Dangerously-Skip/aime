import { useSettingsStore } from '@/stores/settings-store';
import { useProjectStore } from '@/stores/project-store';
import { useConversationStore } from '@/stores/conversation-store';
import { resolveDeckTheme, type ResolvedTheme } from '@/lib/themes/resolve';

/**
 * The deck theme for the current context, resolved once.
 *
 * A hook rather than resolution at each call site because `searchSettings`
 * taught the lesson expensively: it was plumbed through the route and the
 * provider and no client ever populated it, so the whole subsystem was inert
 * and only the Settings "Test" button — which built its own payload — appeared
 * to work. One hook, used by every surface, is harder to half-wire.
 */
/**
 * @param conversationId whose project supplies the project-scoped theme.
 *
 * Keyed on the CONVERSATION, not on `activeProjectId`. That field had zero
 * writers anywhere in `src` — `setActiveProject` was never called — so it was
 * permanently null, `resolveDeckTheme`'s `source: 'project'` branch was dead
 * code, and the scope toggle in the design panel never rendered: there was no
 * way to set a per-project theme, and no way for one to apply.
 *
 * Keying on the conversation is also the only key that cannot go stale. Every
 * other project-scoped value — instructions, knowledge, folder, artifacts —
 * resolves from `conversation.projectId` via `useProjectContext`, so a
 * last-selected-project field would disagree with all of them the moment the
 * open conversation belonged to a different project.
 */
export function useDeckTheme(conversationId?: string | null): ResolvedTheme | null {
  const globalTheme = useSettingsStore((s) => s.deckTheme);
  const projectId = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.projectId ?? null,
  );
  const projectTheme = useProjectStore(
    (s) => s.projects.find((p) => p.id === projectId)?.deckTheme ?? null,
  );
  return resolveDeckTheme({ projectTheme, globalTheme });
}
