"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  const sanitized = useMemo(() => {
    let s = content;
    // Strip complete <function_calls>…</function_calls> blocks (with or without antml: prefix)
    s = s.replace(/<(antml:)?function_calls>[\s\S]*?<\/(antml:)?function_calls>/g, '');
    // Strip trailing incomplete block (streaming — opening tag with no close yet)
    s = s.replace(/<(antml:)?function_calls>[\s\S]*$/g, '');
    return s.trim();
  }, [content]);

  const plugins = useMemo(() => [remarkGfm], []);
  const rehypePlugins = useMemo(() => [rehypeHighlight], []);

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown remarkPlugins={plugins} rehypePlugins={rehypePlugins}>
        {sanitized}
      </ReactMarkdown>
    </div>
  );
});
