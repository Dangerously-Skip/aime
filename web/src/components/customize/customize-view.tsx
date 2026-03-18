"use client";

import { useAppStore } from "@/stores/app-store";
import { SkillDetail } from "./skill-detail";
import { ConnectorDetail } from "./connector-detail";
import { BrowseConnectors } from "./browse-connectors";
import { BrowseMarketplace } from "./browse-marketplace";
import { AutomationSection } from "./automation-section";
import { AgentsPanel } from "./agents-panel";
import { Briefcase, Cable, Zap, Puzzle, ArrowRight, Timer, Bot } from "lucide-react";

const LANDING_ROWS = [
  {
    icon: Cable,
    title: "Connect your tools",
    description: "Integrate with the tools you use to complete your tasks",
    section: "connectors" as const,
  },
  {
    icon: Zap,
    title: "Create new skills",
    description: "Teach Quarry your processes, team norms, and expertise",
    section: "skills" as const,
  },
  {
    icon: Puzzle,
    title: "Browse plugins",
    description: "Tailor Quarry to a specific subject",
    section: "browse-marketplace" as const,
  },
  {
    icon: Timer,
    title: "Automation",
    description: "Schedule cron jobs, configure webhooks, and set up heartbeat check-ins",
    section: "automation" as const,
  },
  {
    icon: Bot,
    title: "Define agents",
    description: "Create specialised AI agents for research, coding, writing, and more",
    section: "agents" as const,
  },
];

function LandingPage() {
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-lg w-full space-y-10">
        {/* Hero */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="flex items-center justify-center h-16 w-16 rounded-2xl border border-border text-muted-foreground">
            <Briefcase className="h-8 w-8" strokeWidth={1.25} />
          </div>
          <p className="text-sm text-muted-foreground">
            Customize and manage the context and tools you are giving Quarry.
          </p>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border">
          {LANDING_ROWS.map((row) => {
            const Icon = row.icon;
            return (
              <button
                key={row.title}
                onClick={() => setCustomizeSection(row.section)}
                className="group flex w-full items-center gap-4 py-5 text-left transition-colors hover:bg-accent/30 -mx-3 px-3 rounded-lg"
              >
                <div className="shrink-0 flex items-center justify-center h-10 w-10 rounded-lg border border-border text-muted-foreground">
                  <Icon className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold">{row.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.description}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CustomizeView() {
  const customizeSection = useAppStore((s) => s.customizeSection);
  const selectedSkillId = useAppStore((s) => s.selectedSkillId);
  const selectedConnectorId = useAppStore((s) => s.selectedConnectorId);

  let content;
  if (customizeSection === "skills") {
    content = <SkillDetail skillId={selectedSkillId} />;
  } else if (customizeSection === "connectors") {
    content = <ConnectorDetail connectorId={selectedConnectorId} />;
  } else if (customizeSection === "browse-connectors") {
    content = <BrowseConnectors />;
  } else if (customizeSection === "browse-marketplace") {
    content = <BrowseMarketplace />;
  } else if (customizeSection === "automation") {
    content = <AutomationSection />;
  } else if (customizeSection === "agents") {
    content = <AgentsPanel />;
  } else {
    content = <LandingPage />;
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      {content}
    </div>
  );
}
