"use client";

import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/common";
// The one tested escaper. This file carried a private copy that differed only in
// the apostrophe entity (&#039; vs &#39; — both valid references for '), and it
// was the guard on a `dangerouslySetInnerHTML` sink with no test of its own.
import { escapeHtml } from "@/lib/documents/render";

interface CodeRendererProps {
  content: string;
  ext: string;
}

const EXT_TO_LANG: Record<string, string> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".css": "css",
  ".scss": "scss",
  ".html": "xml",
  ".xml": "xml",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".sql": "sql",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".dockerfile": "dockerfile",
  ".graphql": "graphql",
  ".swift": "swift",
  ".kt": "kotlin",
  ".md": "markdown",
  ".mdx": "markdown",
};

/**
 * Syntax-highlighted code viewer.
 *
 * Loads highlight.js for the matching language (or auto-detects), injects the
 * appropriate light/dark theme stylesheet at first render, and re-highlights
 * on content change. Theme follows the app's `<html class="dark">` toggle.
 */
export function CodeRenderer({ content, ext }: CodeRendererProps) {
  const lang = EXT_TO_LANG[ext] || "";
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const compute = () => setIsDark(html.classList.contains("dark"));
    compute();
    const obs = new MutationObserver(compute);
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Swap the highlight.js stylesheet for the active theme. We pull from a CDN
  // so we don't have to bundle two themes; cached after first load.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = isDark ? "hljs-theme-dark" : "hljs-theme-light";
    const otherId = isDark ? "hljs-theme-light" : "hljs-theme-dark";
    const url = isDark
      ? "https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.css"
      : "https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github.css";
    document.getElementById(otherId)?.remove();
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = url;
      document.head.appendChild(link);
    }
  }, [isDark]);

  // The fallback is NOT theoretical: EXT_TO_LANG maps .dockerfile to a language
  // the `highlight.js/lib/common` bundle does not register, so hljs throws
  // "Unknown language" and escaping is the only thing standing between file
  // contents and the innerHTML below.
  const highlighted = useMemo(() => {
    try {
      if (lang) {
        return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      return escapeHtml(content);
    }
  }, [content, lang]);

  return (
    <pre className="rounded-lg bg-muted/40 p-4 text-xs leading-relaxed overflow-x-auto font-mono whitespace-pre-wrap break-words">
      <code
        data-testid="code-renderer-output"
        className={`hljs ${lang ? `language-${lang}` : ""}`}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}
