"use client";

import { useEffect, useMemo } from "react";
import hljs from "highlight.js/lib/common";
import { resolveHljsLanguage } from "./hljs-language";
// The one tested escaper. This file carried a private copy that differed only in
// the apostrophe entity (&#039; vs &#39; — both valid references for '), and it
// was the guard on a `dangerouslySetInnerHTML` sink with no test of its own.
import { escapeHtml } from "@/lib/documents/render";
import { useIsDarkTheme } from "@/hooks/use-dark-theme";

interface CodeRendererProps {
  content: string;
  ext: string;
  /** Full file name — dotfiles like `.env.example` carry their real identity
   *  in the BASENAME, not the extension (`getExt` returns ".example"). */
  name?: string;
}

/**
 * Syntax-highlighted code viewer.
 *
 * Loads highlight.js for the matching language (or auto-detects), injects the
 * appropriate light/dark theme stylesheet at first render, and re-highlights
 * on content change. Theme follows the app's `<html class="dark">` toggle.
 */
export function CodeRenderer({ content, ext, name }: CodeRendererProps) {
  // Shared with the editor — see `hljs-language.ts`.
  const { lang, isPlain } = resolveHljsLanguage({ ext, name });
  const isDark = useIsDarkTheme();

  /**
   * Swap the highlight.js stylesheet for the active theme.
   *
   * Served from `public/`, not a CDN. This used to fetch
   * `cdn.jsdelivr.net/npm/highlight.js@11/styles/...` at runtime, which in a
   * DESKTOP app means syntax highlighting silently degrades to unstyled text
   * with no network — and a request to a third party every time the theme
   * changes. The files are already in `node_modules`; `postinstall` copies them
   * beside `pdf.worker.min.mjs`, which solved the same problem the same way.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = isDark ? "hljs-theme-dark" : "hljs-theme-light";
    const otherId = isDark ? "hljs-theme-light" : "hljs-theme-dark";
    const url = isDark
      ? "/hljs/github-dark.css"
      : "/hljs/github.css";
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
      // Plain text skips hljs entirely: auto-detect on non-code (certificates,
      // logs, .env before the basename map existed) invents emphasis spans and
      // reads as broken markdown rather than as the file's actual content.
      if (isPlain) return escapeHtml(content);
      if (lang) {
        return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      return escapeHtml(content);
    }
  }, [content, lang, isPlain]);

  return (
    /*
     * No card chrome. This renders inside the viewer pane, which is already
     * padded and already sits in dockview's rounded panel group — the old
     * `rounded-lg bg-muted/40 p-4` drew a box-in-box-in-box ("weird embedded
     * framing"), with the file's content floating in a nested grey card.
     */
    <pre className="text-xs leading-relaxed overflow-x-auto font-mono whitespace-pre-wrap break-words">
      <code
        data-testid="code-renderer-output"
        className={`hljs ${lang ? `language-${lang}` : ""}`}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}
