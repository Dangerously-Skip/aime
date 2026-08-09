"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMarketplace } from "@/lib/use-marketplace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Zap,
  Cable,
  Puzzle,
  Plus,
  Search,
  ChevronRight,
  Loader2,
  Globe,
  Timer,
  Palette,
} from "lucide-react";

interface SkillItem {
  id: string;
  name: string;
  description: string;
}

interface ConnectorItem {
  id: string;
  name: string;
  type: string;
  disabled: boolean;
  source: string;
}

interface OAuthConnectorItem {
  id: string;
  name: string;
  connected: boolean;
  connectionId?: string;
}

export function SidebarCustomize() {
  const customizeSection = useAppStore((s) => s.customizeSection);
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const selectedSkillId = useAppStore((s) => s.selectedSkillId);
  const setSelectedSkillId = useAppStore((s) => s.setSelectedSkillId);
  const selectedConnectorId = useAppStore((s) => s.selectedConnectorId);
  const setSelectedConnectorId = useAppStore((s) => s.setSelectedConnectorId);

  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [oauthConnectors, setOauthConnectors] = useState<OAuthConnectorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { plugins: marketplacePlugins } = useMarketplace();

  // Fetch data when section changes
  useEffect(() => {
    if (customizeSection === "skills") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- spinner for the fetch this effect starts; nothing to derive during render
      setLoading(true);
      fetch("/api/customize/skills")
        .then((r) => r.json())
        .then((data) => setSkills(data.skills || []))
        .catch(() => setSkills([]))
        .finally(() => setLoading(false));
    } else if (customizeSection === "connectors" || customizeSection === "browse-connectors") {
      setLoading(true);
      Promise.all([
        fetch("/api/customize/connectors")
          .then((r) => r.json())
          .then((data) => setConnectors(data.connectors || []))
          .catch(() => setConnectors([])),
        fetch("/api/nango/status")
          .then((r) => r.json())
          .then((data) => {
            const connected = (data.connectors || []).filter(
              (c: OAuthConnectorItem) => c.connected
            );
            setOauthConnectors(connected);
          })
          .catch(() => setOauthConnectors([])),
      ]).finally(() => setLoading(false));
    }
  }, [customizeSection]);

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredConnectors = connectors.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      {/* Section nav */}
      <div className="px-3 py-1 space-y-0.5">
        <button
          onClick={() => setCustomizeSection("skills")}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            customizeSection === "skills"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Skills</span>
          <span className="text-[10px] text-muted-foreground">{skills.length || ""}</span>
        </button>

        <button
          onClick={() => setCustomizeSection("connectors")}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            customizeSection === "connectors" || customizeSection === "browse-connectors"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <Cable className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Connectors</span>
          <span className="text-[10px] text-muted-foreground">
            {(connectors.length + oauthConnectors.length) || ""}
          </span>
        </button>

        <button
          onClick={() => setCustomizeSection("browse-marketplace")}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            customizeSection === "browse-marketplace"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <Puzzle className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Marketplace</span>
          {marketplacePlugins.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {marketplacePlugins.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setCustomizeSection("design")}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            customizeSection === "design"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <Palette className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Design</span>
        </button>

        <button
          onClick={() => setCustomizeSection("automation")}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            customizeSection === "automation"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <Timer className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Automation</span>
        </button>
      </div>

      <Separator className="bg-sidebar-border my-1 mx-3" />

      {/* List area with search */}
      {(customizeSection === "skills" || customizeSection === "connectors" || customizeSection === "browse-connectors") && (
        <>
          {/* List header */}
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs font-medium text-muted-foreground">
              {customizeSection === "skills" ? "Skills" : "Connected"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-sidebar-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex h-8 w-full rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 pl-8 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Item list */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {!loading && customizeSection === "skills" && (
                <>
                  {filteredSkills.length === 0 && (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                      {skills.length === 0
                        ? "No skills installed. Create one to get started."
                        : "No matching skills"}
                    </div>
                  )}
                  {filteredSkills.map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => setSelectedSkillId(skill.id)}
                      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        selectedSkillId === skill.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                      }`}
                    >
                      <Zap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{skill.name}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                </>
              )}

              {!loading && (customizeSection === "connectors" || customizeSection === "browse-connectors") && (
                <>
                  {/* MCP Connectors */}
                  {filteredConnectors.length > 0 && (
                    <div className="px-2 pt-1 pb-0.5">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        MCP
                      </span>
                    </div>
                  )}
                  {filteredConnectors.map((connector) => (
                    <button
                      key={connector.id}
                      onClick={() => {
                        setCustomizeSection("connectors");
                        setSelectedConnectorId(connector.id);
                      }}
                      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        selectedConnectorId === connector.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                      }`}
                    >
                      <Cable className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{connector.name}</span>
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          connector.disabled
                            ? "bg-muted-foreground/40"
                            : "bg-green-500"
                        }`}
                      />
                    </button>
                  ))}

                  {/* OAuth Connectors */}
                  {oauthConnectors.length > 0 && (
                    <>
                      <div className="px-2 pt-2 pb-0.5">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          OAuth
                        </span>
                      </div>
                      {oauthConnectors
                        .filter((c) =>
                          c.name.toLowerCase().includes(searchQuery.toLowerCase())
                        )
                        .map((connector) => (
                          <button
                            key={`oauth-${connector.id}`}
                            onClick={() => setCustomizeSection("browse-connectors")}
                            className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors text-sidebar-foreground hover:bg-sidebar-accent/50"
                          >
                            <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate flex-1">{connector.name}</span>
                            <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-green-500" />
                          </button>
                        ))}
                    </>
                  )}

                  {/* Browse button */}
                  <div className="px-2 pt-2">
                    <button
                      onClick={() => setCustomizeSection("browse-connectors")}
                      className="flex w-full items-center gap-2 rounded-md border border-dashed border-sidebar-border px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:border-primary/30 transition-colors"
                    >
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 text-left">Browse connectors</span>
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>

                  {filteredConnectors.length === 0 && oauthConnectors.length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No connectors configured yet.
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </>
  );
}
