"use client";

import { useEffect, useState } from "react";
import { useAppStore, type CustomizeSection } from "@/stores/app-store";
import { useCustomizeUiStore } from "@/stores/customize-ui-store";
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
  Timer,
  Palette,
  Bot,
  type LucideIcon,
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

interface NavItem {
  section: CustomizeSection;
  label: string;
  icon: LucideIcon;
  /** Sub-pages that should highlight this item too. */
  alsoActiveFor?: CustomizeSection[];
}

/**
 * Every Customize section, in one list.
 *
 * Agents used to be missing here — reachable only from the landing page, so
 * from inside any other section the only way to it was back out through the
 * landing. One array for all the buttons is what keeps a section from being
 * silently left out again.
 */
export const CUSTOMIZE_NAV: NavItem[] = [
  { section: "skills", label: "Skills", icon: Zap },
  { section: "connectors", label: "Connectors", icon: Cable, alsoActiveFor: ["browse-connectors"] },
  { section: "browse-marketplace", label: "Marketplace", icon: Puzzle },
  { section: "agents", label: "Agents", icon: Bot },
  { section: "design", label: "Design", icon: Palette },
  { section: "automation", label: "Automation", icon: Timer },
];

export function SidebarCustomize() {
  const customizeSection = useAppStore((s) => s.customizeSection);
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const selectedSkillId = useAppStore((s) => s.selectedSkillId);
  const setSelectedSkillId = useAppStore((s) => s.setSelectedSkillId);
  const selectedConnectorId = useAppStore((s) => s.selectedConnectorId);
  const setSelectedConnectorId = useAppStore((s) => s.setSelectedConnectorId);
  const skillsRevision = useCustomizeUiStore((s) => s.skillsRevision);
  const startSkillComposer = useCustomizeUiStore((s) => s.startSkillComposer);

  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { plugins: marketplacePlugins } = useMarketplace();

  // Fetch when the section changes, and again whenever the main pane reports
  // that the skills on disk changed (create / save / delete).
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
      fetch("/api/customize/connectors")
        .then((r) => r.json())
        .then((data) => setConnectors(data.connectors || []))
        .catch(() => setConnectors([]))
        .finally(() => setLoading(false));
    }
  }, [customizeSection, skillsRevision]);

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredConnectors = connectors.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const countFor = (section: CustomizeSection): number | null => {
    if (section === "skills") return skills.length || null;
    if (section === "connectors") return connectors.length || null;
    if (section === "browse-marketplace") return marketplacePlugins.length || null;
    return null;
  };

  const isSkills = customizeSection === "skills";
  const addLabel = isSkills ? "Create skill" : "Add connector";

  /*
   * The list header's `+`. It had no onClick and no label, right beside
   * "No skills installed. Create one to get started." — so the one control
   * that read as the answer to that sentence did nothing at all.
   */
  function handleAdd() {
    if (isSkills) {
      setSelectedSkillId(null);
      startSkillComposer();
    } else {
      setCustomizeSection("browse-connectors");
    }
  }

  return (
    <>
      {/* Section nav */}
      <div className="px-3 py-1 space-y-0.5">
        {CUSTOMIZE_NAV.map(({ section, label, icon: Icon, alsoActiveFor }) => {
          const active = customizeSection === section || !!alsoActiveFor?.includes(customizeSection);
          const count = countFor(section);
          return (
            <button
              key={section}
              onClick={() => setCustomizeSection(section)}
              aria-current={active ? "page" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{label}</span>
              {count !== null && (
                <span className="text-[10px] text-muted-foreground">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <Separator className="bg-sidebar-border my-1 mx-3" />

      {/* List area with search */}
      {(isSkills || customizeSection === "connectors" || customizeSection === "browse-connectors") && (
        <>
          {/* List header */}
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs font-medium text-muted-foreground">
              {isSkills ? "Skills" : "Connected"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-sidebar-foreground hover:text-foreground"
              onClick={handleAdd}
              aria-label={addLabel}
              title={addLabel}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder={isSkills ? "Filter skills…" : "Filter connectors…"}
                aria-label={isSkills ? "Filter skills" : "Filter connectors"}
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

              {!loading && isSkills && (
                <>
                  {filteredSkills.length === 0 && (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                      {skills.length === 0 ? (
                        <>
                          No skills installed.{" "}
                          <button
                            onClick={handleAdd}
                            className="font-medium text-primary hover:underline"
                          >
                            Create one
                          </button>{" "}
                          to get started.
                        </>
                      ) : (
                        "No matching skills"
                      )}
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

                  {filteredConnectors.length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                      {connectors.length === 0 ? "No connectors configured yet." : "No matching connectors"}
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
