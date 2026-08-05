import { useSettingsStore } from '@/stores/settings-store';
import { useProjectStore } from '@/stores/project-store';
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
export function useDeckTheme(): ResolvedTheme | null {
  const globalTheme = useSettingsStore((s) => s.deckTheme);
  const projectTheme = useProjectStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.deckTheme ?? null,
  );
  return resolveDeckTheme({ projectTheme, globalTheme });
}
