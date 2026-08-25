"use client";

import { useEffect, useState } from "react";
import { useWidgetStore } from "@/stores/widget-store";
import { parseIntervalSeconds } from "@/lib/runs/standing-order-goal";
import type { Widget } from "@/lib/widgets/widget";
import { WidgetTile } from "./widget-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Bot, CloudSun, TrendingUp, Globe2 } from "lucide-react";
import { WIDGET_PRESETS, buildPresetWidget } from "@/lib/assistant/widget-presets";

/** The preset icons, by the name each preset declares. */
const PRESET_ICONS: Record<string, typeof Bot> = {
  "cloud-sun": CloudSun,
  "trending-up": TrendingUp,
  "globe-2": Globe2,
};

/**
 * The Cockpit's widget grid. CSS-columns masonry (the Burnbox trick): tiles
 * stack per COLUMN so a short tile doesn't hold a whole row's height hostage,
 * with no layout library. `break-inside-avoid` on the tiles stops fragmenting.
 */
export function WidgetGrid({ onViewRuns }: { onViewRuns?: (goalId: string) => void }) {
  const widgets = useWidgetStore((s) => s.widgets);
  const addWidget = useWidgetStore((s) => s.addWidget);

  // widget-store hydrates lazily (skipHydration).
  useEffect(() => {
    void useWidgetStore.persist.rehydrate();
  }, []);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [recipe, setRecipe] = useState("");
  const [every, setEvery] = useState("");
  const [allowWeb, setAllowWeb] = useState(false);

  const create = () => {
    if (!recipe.trim()) return;
    const widget: Widget = {
      id: globalThis.crypto.randomUUID(),
      title: title.trim() || recipe.trim().slice(0, 40),
      recipe: recipe.trim(),
      render: null,
      enabled: true,
      createdAt: Date.now(),
      allowWeb,
      refreshEverySeconds: parseIntervalSeconds(every) ?? undefined,
    };
    addWidget(widget);
    setAdding(false);
    setTitle("");
    setRecipe("");
    setEvery("");
    setAllowWeb(false);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Widgets
        </h3>
        {/*
          * QUICK-ADD LIVES HERE, next to the things it creates.
          *
          * These were on the ACTIVITY tab — twice, in fact: once in its empty
          * state and once as a toolbar above the feed. Since presets became
          * widgets they landed in the Cockpit, so Activity had two ways to add
          * a thing it could not show, and the two tabs read as the same screen
          * with different furniture.
          *
          * The split the codebase already documents is EVENT vs STATE: Activity
          * is what happened, the Cockpit is what is currently true. A widget is
          * state. Putting the buttons here is that rule applied, and it removes
          * the cross-tab navigation the previous fix needed — you cannot land
          * somewhere you are not, if there is only one place.
          */}
        <div className="ml-auto flex items-center gap-1.5">
          {WIDGET_PRESETS.map((preset) => {
            const Icon = PRESET_ICONS[preset.icon] ?? Bot;
            return (
              <button
                key={preset.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                onClick={() =>
                  addWidget({
                    ...buildPresetWidget(preset),
                    id: globalThis.crypto.randomUUID(),
                    createdAt: Date.now(),
                  })
                }
                title={preset.description}
              >
                <Icon className="h-3 w-3" />
                {preset.label}
              </button>
            );
          })}
          {!adding && (
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-3 w-3" /> New widget
            </Button>
          )}
        </div>
      </div>

      {adding && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-card p-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="h-7 text-xs"
          />
          <Input
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
            placeholder='Recipe — what should this tile show? e.g. "Top HN stories about AI, with points"'
            className="h-7 text-xs"
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <div className="flex items-center gap-2">
            <Input
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              placeholder="Refresh every (e.g. 30m, 2h) — blank = manual"
              className="h-7 flex-1 text-xs"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={allowWeb} onChange={(e) => setAllowWeb(e.target.checked)} />
              allow web
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-6 text-xs" onClick={create} disabled={!recipe.trim()}>
              Create
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            A widget is a saved instruction, re-run on its schedule. Without a scope or web access it
            can only render general knowledge — it will say so rather than invent your data.
          </p>
        </div>
      )}

      {widgets.length === 0 && !adding ? (
        <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
          No widgets yet. Create one here, or ask for one in chat — &quot;make me a widget tracking…&quot;.
        </p>
      ) : (
        <div className="gap-4 [column-fill:balance] [columns:280px]">
          {widgets.map((w) => (
            <WidgetTile key={w.id} widget={w} onViewRuns={onViewRuns} />
          ))}
        </div>
      )}
    </section>
  );
}
