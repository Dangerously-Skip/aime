'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useProjectStore } from '@/stores/project-store';
import { resolveDeckTheme } from '@/lib/themes/resolve';
import { Check, Loader2, Palette } from 'lucide-react';

/**
 * The deck design picker.
 *
 * Previews are miniature SLIDES rendered from each theme's own tokens, not
 * colour swatches. The point of having 36 is that you choose by eye — a grid of
 * hex chips would make the user do the rendering in their head, which is the
 * job the app is supposed to be doing. Cheap, too: the themes are pure custom
 * properties, so a preview needs no iframe and no model call.
 *
 * Two scopes, because "per project as well as global" is how people actually
 * work: a global default answers "what should a deck look like", a project
 * override answers "except for this client". Precedence lives in
 * `resolveDeckTheme`, not here — this only writes the values.
 */

interface ThemeTokens {
  bg: string;
  surface: string;
  text1: string;
  text2: string;
  border: string;
  accent: string;
  fontSans: string;
  fontDisplay: string;
  radius: string;
}

interface DeckTheme {
  id: string;
  label: string;
  group: string;
  tokens: ThemeTokens;
}

/**
 * A theme rendered as the thing it produces.
 *
 * Deliberately shows the parts that differ most between themes and that a user
 * would notice on a real slide: display face, accent, surface against
 * background, border weight and corner radius. A title-and-bullets slide is the
 * commonest slide there is, so it is the honest sample.
 */
function ThemePreview({ tokens }: { tokens: ThemeTokens }) {
  return (
    <div
      className="pointer-events-none aspect-video w-full overflow-hidden"
      style={{
        background: tokens.bg,
        borderRadius: tokens.radius,
        border: `1px solid ${tokens.border}`,
      }}
    >
      <div className="flex h-full flex-col justify-center gap-[6%] px-[8%]">
        <div
          style={{
            color: tokens.text1,
            fontFamily: tokens.fontDisplay,
            fontSize: '13px',
            fontWeight: 700,
            lineHeight: 1.15,
          }}
        >
          Quarterly review
        </div>
        <div style={{ height: 2, width: '22%', background: tokens.accent }} />
        <div className="flex flex-col gap-[4px]">
          {['Revenue up 18% on last quarter', 'Churn steady at 2.1%'].map((line) => (
            <div
              key={line}
              style={{ color: tokens.text2, fontFamily: tokens.fontSans, fontSize: '7px' }}
            >
              {line}
            </div>
          ))}
        </div>
        <div
          className="mt-[2%] self-start px-[6px] py-[3px]"
          style={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: tokens.radius,
            color: tokens.accent,
            fontFamily: tokens.fontSans,
            fontSize: '6px',
          }}
        >
          Detail
        </div>
      </div>
    </div>
  );
}

export function DesignPanel() {
  const deckTheme = useSettingsStore((s) => s.deckTheme);
  const setDeckTheme = useSettingsStore((s) => s.setDeckTheme);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const updateProject = useProjectStore((s) => s.updateProject);

  const [themes, setThemes] = useState<DeckTheme[] | null>(null);
  const [scope, setScope] = useState<'global' | 'project'>('global');

  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => setThemes([]));
  }, []);

  // What a deck would actually use right now, by the same rules the agent uses.
  const effective = resolveDeckTheme({
    projectTheme: activeProject?.deckTheme,
    globalTheme: deckTheme,
  });

  const selectedId = scope === 'project' ? (activeProject?.deckTheme ?? null) : deckTheme;

  const select = (id: string | null) => {
    if (scope === 'project' && activeProject) {
      updateProject(activeProject.id, { deckTheme: id });
    } else {
      setDeckTheme(id);
    }
  };

  const grouped = useMemo(() => {
    const out = new Map<string, DeckTheme[]>();
    for (const t of themes ?? []) {
      const list = out.get(t.group);
      if (list) list.push(t);
      else out.set(t.group, [t]);
    }
    return [...out.entries()];
  }, [themes]);

  if (themes === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      </div>
    );
  }

  if (themes.length === 0) {
    return (
      <div className="text-muted-foreground p-8 text-sm">
        No deck themes are installed. They ship with the app and install on launch —
        restarting should restore them.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Palette className="size-4" /> Design
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          The look of decks produced for you. Applied automatically — you don&apos;t
          need to ask for it each time.
        </p>
      </div>

      {/* Scope. Shown only when there is a project to scope TO; a toggle with one
          reachable option is furniture. */}
      {activeProject && (
        <div className="flex items-center gap-1 rounded-lg p-1 ring-1 ring-foreground/10 w-fit">
          {(
            [
              ['global', 'Everything'],
              ['project', activeProject.name],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setScope(id)}
              className={`rounded-md px-3 py-1 text-xs transition ${
                scope === id ? 'bg-foreground/10 font-medium' : 'text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Says what a deck WOULD use and why — the honest version of "applies
          silently". A default nobody can trace is indistinguishable from the app
          having an opinion you cannot override. */}
      <p className="text-muted-foreground text-xs">
        {effective ? (
          <>
            Decks currently use <span className="text-foreground font-medium">{effective.id}</span>
            {effective.source === 'project' ? ` — set for ${activeProject?.name}.` : ' — the default for everything.'}
          </>
        ) : (
          'No design chosen, so one is picked to suit each deck.'
        )}
      </p>

      <div className="space-y-6">
        {scope === 'project' && (
          <button
            type="button"
            onClick={() => select(null)}
            className={`w-full rounded-lg p-3 text-left text-sm ring-1 transition ${
              selectedId === null ? 'ring-foreground/30 bg-foreground/5' : 'ring-foreground/10'
            }`}
          >
            <span className="font-medium">Use the default</span>
            <span className="text-muted-foreground"> — whatever is set for everything</span>
          </button>
        )}

        {grouped.map(([group, list]) => (
          <div key={group}>
            <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
              {group}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => select(t.id)}
                  className={`group rounded-lg p-2 text-left ring-1 transition hover:ring-foreground/30 ${
                    selectedId === t.id ? 'ring-2 ring-foreground/60' : 'ring-foreground/10'
                  }`}
                >
                  <ThemePreview tokens={t.tokens} />
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium">{t.label}</span>
                    {selectedId === t.id && <Check className="size-3 shrink-0" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
