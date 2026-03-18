"use client";

import { useEffect, useRef, useState } from "react";
import { base64ToUint8Array } from "@/lib/file-utils";

interface PdfRendererProps {
  content: string;
  encoding: "utf-8" | "base64";
  name: string;
}

export function PdfRenderer({ content, encoding, name }: PdfRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!content) return;

    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const data =
          encoding === "base64"
            ? base64ToUint8Array(content)
            : new TextEncoder().encode(content);

        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;

        setPageCount(pdf.numPages);

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        // Render each page to a canvas
        const containerWidth = container.clientWidth || 560;

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);

          // Scale to fit container width
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = containerWidth / unscaledViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.marginBottom = "8px";
          canvas.style.borderRadius = "4px";
          canvas.style.border = "1px solid var(--border)";

          container.appendChild(canvas);

          await page.render({ canvas, viewport }).promise;
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render PDF");
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [content, encoding]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {loading && (
        <p className="text-sm text-muted-foreground animate-pulse text-center py-4">
          Rendering PDF...
        </p>
      )}
      {!loading && (
        <p className="text-xs text-muted-foreground">
          {name} &mdash; {pageCount} page{pageCount !== 1 ? "s" : ""}
        </p>
      )}
      <div ref={containerRef} />
    </div>
  );
}
