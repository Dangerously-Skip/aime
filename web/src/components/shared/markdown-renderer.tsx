"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import dynamic from "next/dynamic";

const MermaidBlock = dynamic(
  () => import("./mermaid-block").then((m) => m.MermaidBlock),
  { ssr: false }
);

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
    // Strip complete <function_calls>...</function_calls> blocks (with or without antml: prefix)
    s = s.replace(/<(antml:)?function_calls>[\s\S]*?<\/(antml:)?function_calls>/g, '');
    // Strip trailing incomplete block (streaming — opening tag with no close yet)
    s = s.replace(/<(antml:)?function_calls>[\s\S]*$/g, '');
    return s.trim();
  }, [content]);

  const plugins = useMemo(() => [remarkGfm], []);
  const rehypePlugins = useMemo(() => [rehypeHighlight], []);

  const components = useMemo(
    () => ({
      code({ className: codeClassName, children, ...props }: React.ComponentProps<"code"> & { inline?: boolean }) {
        const match = /language-(\w+)/.exec(codeClassName || "");
        const lang = match?.[1];

        // Render mermaid code blocks as diagrams
        if (lang === "mermaid") {
          const chart = String(children).replace(/\n$/, "");
          return <MermaidBlock chart={chart} />;
        }

        // For inline code or code without a language, render normally
        return (
          <code className={codeClassName} {...props}>
            {children}
          </code>
        );
      },
    }),
    []
  );

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={plugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
});
