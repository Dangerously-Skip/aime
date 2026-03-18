"use client";

import { useEffect, useState } from "react";
import JSZip from "jszip";
import { base64ToUint8Array } from "@/lib/file-utils";

interface PptxRendererProps {
  content: string;
  encoding: "utf-8" | "base64";
  name: string;
}

interface SlideContent {
  index: number;
  texts: string[];
}

/** Extract text content from a PPTX slide XML string. */
function extractSlideTexts(xml: string): string[] {
  const texts: string[] = [];
  // Match <a:t>...</a:t> tags which contain the actual text runs in OOXML
  const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text) texts.push(text);
  }
  return texts;
}

export function PptxRenderer({ content, encoding, name }: PptxRendererProps) {
  const [slides, setSlides] = useState<SlideContent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!content) return;

    const data =
      encoding === "base64"
        ? base64ToUint8Array(content)
        : new TextEncoder().encode(content);

    JSZip.loadAsync(data)
      .then(async (zip) => {
        const slideFiles = Object.keys(zip.files)
          .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
          .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
            const numB = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
            return numA - numB;
          });

        const parsed: SlideContent[] = [];
        for (let i = 0; i < slideFiles.length; i++) {
          const xml = await zip.files[slideFiles[i]].async("string");
          parsed.push({
            index: i + 1,
            texts: extractSlideTexts(xml),
          });
        }

        setSlides(parsed);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to parse PPTX");
        setLoading(false);
      });
  }, [content, encoding]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground animate-pulse">Parsing presentation...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {name} &mdash; {slides.length} slide{slides.length !== 1 ? "s" : ""}
      </p>

      {slides.map((slide) => (
        <div
          key={slide.index}
          className="rounded-lg border border-border bg-muted/20 p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">
              Slide {slide.index}
            </span>
          </div>
          {slide.texts.length > 0 ? (
            <div className="space-y-1">
              {slide.texts.map((text, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {text}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No text content</p>
          )}
        </div>
      ))}
    </div>
  );
}
