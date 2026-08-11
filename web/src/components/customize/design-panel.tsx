'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/** The deck's authored size. Previews scale this rather than restyling it. */
const DECK_W = 1280;
const DECK_H = 720;
import { useSettingsStore } from '@/stores/settings-store';
import { useProjectStore } from '@/stores/project-store'
import { useChatStore } from '@/stores/chat-store'
import { useConversationStore } from '@/stores/conversation-store';
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
 * A theme rendered by its OWN stylesheet, in an iframe.
 *
 * The first version reimplemented a slide in React from a handful of parsed
 * tokens, and it made every theme look the same — because it used bg, text,
 * border, accent and radius, and ignored `--grad` and `--shadow`, which is
 * precisely where the character lives. `neo-brutalism` is a `6px 6px 0 #000`
 * offset shadow; `cyberpunk-neon` is a triple neon glow; `memphis-pop` is a
 * three-stop gradient under Archivo Black. None of that survived, so 36
 * distinct designs rendered as one layout in different colours.
 *
 * So the preview now loads the real `base.css` and the real theme file and uses
 * the real class names from `templates/deck.html`. It is not a picture of a
 * slide; it is a slide. Anything upstream adds — new tokens, new primitives —
 * shows up here for free rather than needing this component taught about it.
 *
 * `srcDoc` rather than a src URL so there is no per-theme route, and
 * `pointer-events-none` so the card stays clickable through the frame.
 *
 * `is-active` on the slide is load-bearing and easy to miss: base.css ships
 * `.slide{opacity:0}` and reveals the current one via `.slide.is-active`, a
 * class `runtime.js` normally adds. The runtime is deliberately not loaded here
 * (and the sandbox blocks scripts anyway), so without it every preview rendered
 * as an empty coloured rectangle — the theme's background and nothing else.
 */
function ThemePreview({ id }: { id: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  /**
   * Scale is measured, not expressed in CSS, because CSS cannot express it: a
   * unitless factor derived from the container width has no viewport-unit form
   * that `scale()` accepts. The cards are a responsive grid, so it is observed
   * rather than computed once.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / DECK_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const css = (f: string) => `/api/themes/asset?file=${encodeURIComponent(f)}`;

  const srcDoc = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="${css('fonts.css')}">
<link rel="stylesheet" href="${css('base.css')}">
<link rel="stylesheet" href="${css(`themes/${id}.css`)}">
<style>
  /* The deck renders at its true 1280x720 here and the IFRAME ELEMENT is
     scaled from outside. The obvious in-frame version —
     transform:scale(calc(100vw / 1280)) — is invalid CSS: scale() takes a
     unitless number and calc() on a viewport unit yields a LENGTH, so the whole
     declaration is dropped and the deck renders unscaled. Which is what
     happened: the card showed the top-left corner of a 1280x720 slide whose
     content is vertically centred at y~360, i.e. nothing. */
  html,body{margin:0;overflow:hidden;background:var(--bg);}
</style>
</head><body>
<div class="deck"><section class="slide is-active">
  <p class="kicker">Q3 · Board update</p>
  <h1 class="h1">Revenue grew <span class="gradient-text">18%</span><br>on last quarter</h1>
  <p class="lede">Churn steady at 2.1% · NRR 114%</p>
  <div class="grid g3 mt-l">
    <div class="card"><strong>18%</strong><br><span class="dim">Revenue</span></div>
    <div class="card card-accent"><strong>2.1%</strong><br><span class="dim">Churn</span></div>
    <div class="card card-outline"><strong>114%</strong><br><span class="dim">NRR</span></div>
  </div>
  <div class="deck-footer"><span class="dim2">AIME</span></div>
</section></div>
</body></html>`;

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none aspect-video w-full overflow-hidden rounded-md"
    >
      {scale > 0 && (
        <iframe
          title=""
          aria-hidden
          tabIndex={-1}
          loading="lazy"
          sandbox=""
          srcDoc={srcDoc}
          style={{
            width: DECK_W,
            height: DECK_H,
            border: 0,
            pointerEvents: 'none',
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        />
      )}
    </div>
  );
}

export function DesignPanel() {
  const deckTheme = useSettingsStore((s) => s.deckTheme);
  const setDeckTheme = useSettingsStore((s) => s.setDeckTheme);
  const projects = useProjectStore((s) => s.projects);
  const updateProject = useProjectStore((s) => s.updateProject);

  /*
   * The project of the CONVERSATION that is open, not `activeProjectId`.
   *
   * `setActiveProject` has no callers anywhere in `src`, so that field is
   * permanently null: `activeProject` was always undefined, the
   * Everything/<project> toggle below never rendered, and there was no way to
   * set a per-project theme at all — while `resolveDeckTheme` carried a
   * `source: 'project'` branch that could therefore never fire.
   *
   * The conversation is also the right key rather than merely an available one:
   * every other project-scoped value resolves that way, so a last-selected
   * field would disagree with all of them as soon as you opened a conversation
   * belonging to a different project.
   */
  const currentChatId = useChatStore((s) => s.currentChatId);
  const conversations = useConversationStore((s) => s.conversations);
  const activeProjectId =
    conversations.find((c) => c.id === currentChatId)?.projectId ?? null;

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
      <div className="flex flex-1 items-center justify-center min-h-0">
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

  /**
   * `flex-1 overflow-y-auto min-h-0`, and `min-h-0` is the load-bearing part.
   *
   * The parent is `absolute inset-0 flex flex-col`. Without `min-h-0` a flex
   * child's implied `min-height: auto` keeps it at its content height, so it
   * grows past the viewport and `overflow-y-auto` never engages — the panel
   * renders correctly and simply cannot be scrolled, which is exactly how this
   * shipped. Every other panel here carries the same trio.
   */
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
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
                  <ThemePreview id={t.id} />
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
    </div>
  );
}
