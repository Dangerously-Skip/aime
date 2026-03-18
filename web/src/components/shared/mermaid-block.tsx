"use client";

import { useEffect, useRef, useState, useId } from "react";

interface MermaidBlockProps {
  chart: string;
}

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        fontFamily: "inherit",
      });
      return m;
    });
  }
  return mermaidPromise;
}

export function MermaidBlock({ chart }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const uniqueId = useId().replace(/:/g, "-");

  useEffect(() => {
    if (!chart.trim()) return;

    let cancelled = false;

    getMermaid()
      .then(async (m) => {
        if (cancelled) return;
        try {
          const { svg } = await m.default.render(`mermaid-${uniqueId}`, chart.trim());
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to render diagram");
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Mermaid");
        }
      });

    return () => { cancelled = true; };
  }, [chart, uniqueId]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
        <p className="text-xs text-destructive mb-2">Mermaid diagram error:</p>
        <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{error}</pre>
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">Show source</summary>
          <pre className="mt-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap">{chart}</pre>
        </details>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex justify-center rounded-lg bg-muted/30 p-4 overflow-x-auto [&_svg]:max-w-full"
    />
  );
}
