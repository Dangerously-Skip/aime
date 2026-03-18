"use client";

import { useEffect, useState } from "react";
import mammoth from "mammoth";
import { base64ToArrayBuffer } from "@/lib/file-utils";

interface DocxRendererProps {
  content: string;
  encoding: "utf-8" | "base64";
}

export function DocxRenderer({ content, encoding }: DocxRendererProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!content) return;

    const arrayBuffer =
      encoding === "base64"
        ? base64ToArrayBuffer(content)
        : new TextEncoder().encode(content).buffer;

    mammoth
      .convertToHtml({ arrayBuffer })
      .then((result) => {
        setHtml(result.value);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to parse DOCX");
      });
  }, [content, encoding]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground animate-pulse">Converting document...</p>
      </div>
    );
  }

  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none rounded-lg bg-background p-6 border border-border"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
