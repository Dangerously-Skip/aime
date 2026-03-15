"use client";

import { FileText, Code2, Globe, FileType } from "lucide-react";
import type { ParsedArtifact } from "@/lib/artifacts/parser";

interface ArtifactCardProps {
  artifact: ParsedArtifact;
  onClick: (artifact: ParsedArtifact) => void;
}

const TYPE_META: Record<
  ParsedArtifact["type"],
  { icon: typeof FileText; label: string }
> = {
  markdown: { icon: FileText, label: "Document" },
  code: { icon: Code2, label: "Code" },
  html: { icon: Globe, label: "HTML" },
  text: { icon: FileType, label: "Text" },
};

function getPreviewLines(content: string, count = 2): string {
  return content
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, count)
    .join("\n");
}

export function ArtifactCard({ artifact, onClick }: ArtifactCardProps) {
  const meta = TYPE_META[artifact.type];
  const Icon = meta.icon;
  const preview = getPreviewLines(artifact.content);

  return (
    <button
      type="button"
      onClick={() => onClick(artifact)}
      className="w-full max-w-md text-left rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors p-3.5 my-2 group cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-primary/10 p-2">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {artifact.title}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {artifact.language || meta.label}
            </span>
          </div>
          {preview && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2 font-mono">
              {preview}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
