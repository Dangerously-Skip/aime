"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMarketplace } from "@/lib/use-marketplace";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplace";
import { PluginRow } from "./plugin-row";
import { ArrowLeft, Search, Loader2, Puzzle } from "lucide-react";

export function BrowseMarketplace() {
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const { plugins, categories, loading } = useMarketplace();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return plugins.filter((p) => {
      const matchesSearch =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.category || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.keywords || []).some((k) =>
          k.toLowerCase().includes(searchQuery.toLowerCase())
        );
      const matchesCategory =
        categoryFilter === "all" || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [plugins, searchQuery, categoryFilter]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <button
          onClick={() => setCustomizeSection("landing")}
          className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold">Marketplace</h2>
          <p className="text-xs text-muted-foreground">
            Official Claude Code plugins and MCP servers.
          </p>
        </div>
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search plugins"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 pl-8 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-border shrink-0 overflow-x-auto">
        <button
          onClick={() => setCategoryFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
            categoryFilter === "all"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              categoryFilter === cat
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {MARKETPLACE_CATEGORIES[cat] || cat}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Puzzle className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                No plugins match your search.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {filtered.length} plugin{filtered.length !== 1 ? "s" : ""}
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {filtered.map((plugin) => (
                  <PluginRow key={plugin.name} plugin={plugin} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
