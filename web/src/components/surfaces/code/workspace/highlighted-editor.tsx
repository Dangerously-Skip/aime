"use client";

import { useEffect, useMemo, useRef } from "react";
import hljs from "highlight.js/lib/common";
import { hljsLanguageFor } from "@/components/shared/file-renderers/hljs-language";

/**
 * A textarea that keeps its syntax highlighting.
 *
 * Editing a file dropped every colour: the viewer rendered highlighted HTML,
 * and clicking the pencil swapped it for a bare `<textarea>`, which can only
 * ever be one colour. So the moment you started changing code you lost the one
 * thing that makes code readable — and it happened silently, because a plain
 * textarea looks deliberate rather than broken.
 *
 * The standard technique, and the only one that keeps a real textarea: paint
 * the highlighted copy UNDERNEATH, and make the textarea's own text invisible
 * while leaving its caret and selection alone. Native editing, native
 * undo/redo, native spellcheck-off, native accessibility — with colour.
 *
 * WHAT MAKES IT LINE UP, all of which must match between the two layers or the
 * text visibly separates as you type:
 *
 *   font-family, font-size, line-height, letter-spacing, tab-size, padding,
 *   white-space and wrapping mode, and the box width.
 *
 * They are set once, here, in a shared class rather than duplicated on both
 * elements — duplication is how these drift, and the drift is invisible until
 * someone types a long line.
 *
 * The overlay is `aria-hidden` and `pointer-events-none`: it is a picture of
 * the text, and the textarea is the text. A screen reader that met both would
 * read the file twice.
 */
export function HighlightedEditor({
  value,
  onChange,
  ext,
  autoFocus,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  /** File extension, for language selection. Falls back to auto-detect. */
  ext?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const lang = useMemo(() => hljsLanguageFor(ext), [ext]);

  const html = useMemo(() => {
    /*
     * A TRAILING NEWLINE NEEDS A CHARACTER TO SIT ON.
     *
     * `<pre>` collapses a final newline, so with the caret on a new last line
     * the textarea has scrolled one row further than the overlay and the two
     * drift apart exactly when you are typing. A trailing space is enough.
     */
    const text = value.endsWith("\n") ? `${value} ` : value;
    try {
      if (lang) return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      return hljs.highlightAuto(text).value;
    } catch {
      // Same fallback as the viewer: show the file rather than nothing.
      return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
    }
  }, [value, lang]);

  /** The overlay follows the textarea's scroll; it never scrolls on its own. */
  const syncScroll = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  };

  // Re-sync when the text changes: an edit can move the scroll position
  // without firing a scroll event.
  useEffect(syncScroll, [value]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <pre
        ref={preRef}
        aria-hidden
        className="hl-editor-layer pointer-events-none absolute inset-0 overflow-hidden"
      >
        <code className={`hljs ${lang ? `language-${lang}` : ""}`} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        autoFocus={autoFocus}
        data-testid="code-editor-input"
        /*
         * `text-transparent` with `caret-color` set: the characters come from
         * the layer below, the caret and the selection highlight are still the
         * browser's own. Making the text `opacity-0` instead would take the
         * caret with it.
         */
        className="hl-editor-layer absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-[var(--foreground)] outline-none"
      />
    </div>
  );
}
