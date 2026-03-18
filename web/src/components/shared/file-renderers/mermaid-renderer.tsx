"use client";

import { MermaidBlock } from "@/components/shared/mermaid-block";

interface MermaidRendererProps {
  content: string;
}

export function MermaidRenderer({ content }: MermaidRendererProps) {
  return (
    <div className="py-2">
      <MermaidBlock chart={content} />
    </div>
  );
}
