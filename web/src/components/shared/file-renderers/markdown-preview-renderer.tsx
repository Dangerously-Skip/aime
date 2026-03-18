"use client";

import { MarkdownRenderer } from "@/components/shared/markdown-renderer";

interface MarkdownPreviewRendererProps {
  content: string;
}

export function MarkdownPreviewRenderer({ content }: MarkdownPreviewRendererProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <MarkdownRenderer content={content} />
    </div>
  );
}
